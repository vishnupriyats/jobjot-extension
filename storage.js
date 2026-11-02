// storage.js
// -----------------------------------------------------------------------------
// Small helper functions for reading and writing jobs, shared by BOTH pages
// (popup.html and tracker.html). Keeping them in one file means the two pages
// always agree on how the data is stored.
//
// How the data is stored:
//   chrome.storage.local is a simple key/value store that Chrome gives every
//   extension (it needs the "storage" permission in manifest.json). We keep
//   everything under ONE key, "jobs", whose value is an array of job objects:
//
//   { jobs: [ { id, title, company, url, ... }, { ... } ] }
// -----------------------------------------------------------------------------

// The key name we use inside chrome.storage.local.
const JOBS_KEY = "jobs";

// The status choices. Used to build the dropdown in the popup so the list
// only lives in one place.
const STATUSES = ["Saved", "Applied", "Interview", "Offer", "Rejected", "Ghosted"];

// Read every saved job. Returns a Promise that resolves to an array.
// "async" lets us use "await" inside, which waits for Chrome to answer.
async function getJobs() {
  const result = await chrome.storage.local.get(JOBS_KEY);
  // If nothing has been saved yet, result.jobs is undefined, so fall back to [].
  return result[JOBS_KEY] || [];
}

// Replace the whole list of jobs with a new array.
async function setJobs(jobs) {
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
}

// Add one new job to the end of the list.
async function addJob(job) {
  const jobs = await getJobs();
  jobs.push(job);
  await setJobs(jobs);
}

// Change some fields of one job, for example updateJob(id, { status: "Offer" }).
// Fields not listed in "changes" stay as they were.
async function updateJob(id, changes) {
  const jobs = await getJobs();
  // map() builds a new list: the matching job gets the changes merged in
  // ("..." copies an object's fields), every other job is kept as is.
  await setJobs(jobs.map((job) => (job.id === id ? { ...job, ...changes } : job)));
}

// Remove the job whose id matches.
async function deleteJob(id) {
  const jobs = await getJobs();
  // filter() keeps every job EXCEPT the one with this id.
  await setJobs(jobs.filter((job) => job.id !== id));
}

// --- Duplicate check ---------------------------------------------------------
// Used by the popup to warn you before saving the same job twice.

// Parts of a web address that only track where you clicked from (e.g.
// "?utm_source=newsletter"). They're ignored when comparing addresses, so the
// same job reached from two different links still counts as the same.
const TRACKING_PARAMS = /^(utm_.*|ref|refid|trackingid|trk|src|source|gh_src|lever-source|from|tk|lipi)$/i;

// A simplified version of a web address for comparing: no "www.", no
// trailing "/", no "#section", no tracking parts, and all lower case.
// Returns "" for anything that isn't a normal web address.
function normalizeUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return ""; // not a valid address
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  const params = [...parsed.searchParams]
    .filter(([name]) => !TRACKING_PARAMS.test(name))
    .sort(([a], [b]) => a.localeCompare(b)); // order doesn't matter
  const query = new URLSearchParams(params).toString();
  const address = parsed.hostname.replace(/^www\./, "") + parsed.pathname.replace(/\/+$/, "");
  return (address + (query ? "?" + query : "")).toLowerCase();
}

// Find a saved job that looks like the same one: the same web address, or
// the same title AND company (ignoring upper/lower case). Returns the saved
// job, or null if there's none.
function findDuplicate(job, jobs) {
  const url = normalizeUrl(job.url);
  const same = (a, b) => Boolean(a && b) && a.trim().toLowerCase() === b.trim().toLowerCase();
  return jobs.find((other) =>
    other.id !== job.id &&
    ((url && normalizeUrl(other.url) === url) ||
     (same(job.title, other.title) && same(job.company, other.company)))
  ) || null;
}

// --- Follow-up reminders -----------------------------------------------------
// Used by background.js (to show the notification) and tracker.js (to show a
// "Follow up" tag). Two extra fields may be stored on a job:
//   reminded:    true once the notification has been shown for it
//   snoozeUntil: "YYYY-MM-DD" set by "Remind me in 3 days"

// How many days after applying, with no reply, to remind you to follow up.
const FOLLOW_UP_DAYS = 10;
// How long "Remind me in 3 days" waits.
const SNOOZE_DAYS = 3;

// Whole days from one "YYYY-MM-DD" date to another, or null if either date
// isn't in that format (for example a date imported as "10/24/2026").
function daysBetween(from, to) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(from || "") || !pattern.test(to || "")) return null;
  // Date.UTC avoids daylight-saving changes making a day 23 or 25 hours long.
  const toUtc = (date) => Date.UTC(...date.split("-").map((part, i) => Number(part) - (i === 1 ? 1 : 0)));
  return Math.round((toUtc(to) - toUtc(from)) / 86400000); // ms in a day
}

// The "YYYY-MM-DD" date a number of days after another one.
function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day + days); // JS rolls over months for us
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0")].join("-");
}

// Has this job been waiting at "Applied" for FOLLOW_UP_DAYS or more?
function needsFollowUp(job, today = todayString()) {
  if (job.status !== "Applied") return false;
  const days = daysBetween(job.dateApplied, today);
  return days !== null && days >= FOLLOW_UP_DAYS;
}

// Should a notification be shown for this job now? Same as above, but not if
// one was already shown, or it's been snoozed until a later date.
function isReminderDue(job, today = todayString()) {
  if (!needsFollowUp(job, today) || job.reminded) return false;
  return !job.snoozeUntil || today >= job.snoozeUntil;
}

// Today's date as "YYYY-MM-DD" in the user's LOCAL time zone.
// (This is the format an <input type="date"> expects.)
// We don't use toISOString() because that uses UTC time and can be a day off.
function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0"); // months start at 0
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
