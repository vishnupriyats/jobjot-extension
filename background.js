// background.js
// -----------------------------------------------------------------------------
// The extension's "service worker": a script Chrome runs in the background,
// even when the popup and tracker page are closed (manifest.json points to it
// under "background"). Its only job is follow-up reminders:
//
//   Once an hour, and whenever Chrome starts, it looks for jobs that have been
//   at status "Applied" for 10+ days (FOLLOW_UP_DAYS in storage.js) and shows
//   a desktop notification for each, with two buttons:
//     - "Remind me in 3 days" - show it again later
//     - "Open tracker"        - open tracker.html
//   Clicking the notification itself also opens the tracker.
//
// Chrome stops a service worker when it's idle and starts it again when
// something happens (an alarm, a notification click), so all the listeners
// below are registered at the top level, every time the script starts.
//
// Needs the "alarms" and "notifications" permissions in manifest.json.
// -----------------------------------------------------------------------------

// Load getJobs(), setJobs(), updateJob(), isReminderDue() etc. Service workers
// can't use <script> tags, so importScripts() does the same job.
importScripts("storage.js");

const ALARM_NAME = "follow-up-check";
// Notification ids are "follow-up:<job id>", or this for the summary one.
const SUMMARY_ID = "follow-up:summary";
// More reminders than this at once are combined into one summary notification.
const MAX_SEPARATE_NOTIFICATIONS = 3;

// --- When to check -------------------------------------------------------------

// When the extension is installed or updated, and when Chrome starts:
// (re)create the hourly alarm and check straight away. Creating an alarm with
// the same name replaces the old one, so it never runs twice an hour.
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);

function start() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  checkFollowUps();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkFollowUps();
});

// --- The check -------------------------------------------------------------------

async function checkFollowUps() {
  const today = todayString();
  const jobs = await getJobs();
  const due = jobs.filter((job) => isReminderDue(job, today));
  if (due.length === 0) return;

  // Mark them as reminded FIRST, so the next check doesn't show them again.
  const dueIds = new Set(due.map((job) => job.id));
  await setJobs(jobs.map((job) =>
    dueIds.has(job.id) ? { ...job, reminded: true, snoozeUntil: "" } : job
  ));

  if (due.length <= MAX_SEPARATE_NOTIFICATIONS) {
    for (const job of due) {
      const days = daysBetween(job.dateApplied, today);
      chrome.notifications.create("follow-up:" + job.id, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Time to follow up?",
        message: `You applied to ${jobName(job)} ${days} days ago and it's still marked Applied.`,
        buttons: [{ title: `Remind me in ${SNOOZE_DAYS} days` }, { title: "Open tracker" }],
        requireInteraction: true, // stay on screen until you deal with it
      });
    }
  } else {
    // Lots at once (e.g. after importing old jobs): one notification instead.
    chrome.notifications.create(SUMMARY_ID, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${due.length} applications to follow up on`,
      message: due.slice(0, 3).map(jobName).join(", ") + `, and ${due.length - 3} more.`,
      buttons: [{ title: "Open tracker" }],
      requireInteraction: true,
    });
  }
}

// "Data Analyst at Acme", coping with a missing title or company.
function jobName(job) {
  if (job.title && job.company) return `${job.title} at ${job.company}`;
  return job.title || job.company || "a job";
}

// --- Clicks on the notifications ---------------------------------------------------

// Clicking the notification itself opens the tracker.
chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("follow-up:")) return;
  openTracker();
  chrome.notifications.clear(notificationId);
});

// buttonIndex is 0 for the first button, 1 for the second.
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (!notificationId.startsWith("follow-up:")) return;
  chrome.notifications.clear(notificationId);

  // The summary only has "Open tracker"; single-job ones have
  // "Remind me in 3 days" first.
  const snooze = notificationId !== SUMMARY_ID && buttonIndex === 0;
  if (snooze) {
    const jobId = notificationId.slice("follow-up:".length);
    await updateJob(jobId, { reminded: false, snoozeUntil: addDays(todayString(), SNOOZE_DAYS) });
  } else {
    openTracker();
  }
});

function openTracker() {
  chrome.tabs.create({ url: chrome.runtime.getURL("tracker.html") });
}
