// popup.js
// -----------------------------------------------------------------------------
// Code for the popup window (popup.html). It:
//   1. Fills the Status dropdown and sets the date to today.
//   2. Pre-fills the job title, company, location, etc. from the job page
//      you're looking at (using extractJobDetails() from extract.js).
//   3. Warns if the job looks like one you've already saved.
//   4. Saves the form to chrome.storage.local when you click "Save job".
//   5. Opens tracker.html when you click "View all jobs".
//
// Functions like addJob(), findDuplicate(), STATUSES and todayString() come
// from storage.js, which popup.html loads before this file.
// -----------------------------------------------------------------------------

// Grab the page elements we need, once, so we can reuse them.
const form = document.getElementById("job-form");
const statusSelect = document.getElementById("status");
const message = document.getElementById("message");
const saveButton = document.getElementById("save-button");

// --- 1. Build the Status dropdown -------------------------------------------
// For each status word, create an <option> and add it to the <select>.
for (const status of STATUSES) {
  const option = document.createElement("option");
  option.value = status;
  option.textContent = status;
  statusSelect.appendChild(option);
}
// Most people open the popup right after applying, so default to "Applied".
statusSelect.value = "Applied";

// Default the date to today.
document.getElementById("dateApplied").value = todayString();

// --- 2. Pre-fill from the current tab ---------------------------------------
// The "activeTab" permission lets us see the tab you were on when you clicked
// the extension icon — and ONLY that tab, only right now. We use it as a
// starting point; you can edit or clear any of these fields.
async function prefillFromCurrentTab() {
  // Ask Chrome for the active tab in the current window.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Only pre-fill normal web pages (skip things like chrome://newtab).
  if (!tab || !tab.url || !tab.url.startsWith("http")) return;

  // Start with the address and tab title, in case reading the page fails.
  document.getElementById("url").value = tab.url;
  document.getElementById("title").value = tab.title || "";

  // Then run extractJobDetails() (from extract.js) inside that tab to read
  // the job title, company and so on from the page itself.
  let details;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobDetails,
    });
    details = injection && injection.result;
  } catch {
    // Some pages can't be read by any extension (for example the Chrome Web
    // Store). Keep the tab title and address from above.
    return;
  }
  if (!details) return;

  // Fill each field we found — but never overwrite something you've already
  // started typing while the page was being read.
  const fields = ["title", "company", "location", "salary", "source", "url"];
  for (const name of fields) {
    const input = document.getElementById(name);
    const untouched = input.value === "" || input.value === tab.title || input.value === tab.url;
    if (details[name] && untouched) input.value = details[name];
  }
}
// Once the fields are filled in, check whether this job is already saved.
prefillFromCurrentTab().finally(checkDuplicate);

// --- 3. Duplicate warning ------------------------------------------------------
// If the address, or the title and company, match a job you've already saved,
// show a warning. Saving is still allowed (maybe you're re-applying), but the
// first click on the button only turns it into "Save anyway".

const duplicateBox = document.getElementById("duplicate");
const duplicateLink = document.getElementById("duplicate-link");
// The id of the saved job you've already been warned about and chose to
// "Save anyway" for. null means no warning has been accepted yet.
let confirmedDuplicateId = null;

// Compare the form against the saved jobs, show or hide the warning, and
// return the matching saved job (or null).
async function checkDuplicate() {
  const formJob = {
    url: document.getElementById("url").value,
    title: document.getElementById("title").value,
    company: document.getElementById("company").value,
  };
  const duplicate = findDuplicate(formJob, await getJobs());

  duplicateBox.hidden = !duplicate;
  // If the match changed (or went away), you haven't confirmed this one yet.
  if (!duplicate || duplicate.id !== confirmedDuplicateId) {
    confirmedDuplicateId = null;
    saveButton.textContent = "Save job";
  }
  if (duplicate) {
    let text = `Already saved: "${duplicate.title}" at ${duplicate.company} (${duplicate.status}`;
    if (duplicate.dateApplied) text += `, applied ${duplicate.dateApplied}`;
    document.getElementById("duplicate-text").textContent = text + ").";
    // Open the tracker already searching for this job (see tracker.js).
    duplicateLink.dataset.search = `${duplicate.title} ${duplicate.company}`;
  }
  return duplicate;
}

// Check again whenever you change the address, title or company.
for (const id of ["url", "title", "company"]) {
  document.getElementById(id).addEventListener("input", checkDuplicate);
}

duplicateLink.addEventListener("click", (event) => {
  event.preventDefault();
  const search = encodeURIComponent(duplicateLink.dataset.search || "");
  chrome.tabs.create({ url: chrome.runtime.getURL("tracker.html?q=" + search) });
  window.close();
});

// --- 4. Save the job when the form is submitted -----------------------------
form.addEventListener("submit", async (event) => {
  // By default a form submit reloads the page. We don't want that.
  event.preventDefault();

  // Already saved? The first click only asks you to confirm.
  const duplicate = await checkDuplicate();
  if (duplicate && duplicate.id !== confirmedDuplicateId) {
    confirmedDuplicateId = duplicate.id;
    saveButton.textContent = "Save anyway";
    showMessage('This job is already saved. Click "Save anyway" to save it again.', "error");
    return;
  }

  // FormData reads every field that has a "name" attribute.
  const data = new FormData(form);

  // Build the job object we'll store. trim() removes extra spaces.
  const job = {
    // A unique id so we can find this job later (e.g. to delete it).
    id: crypto.randomUUID(),
    title: data.get("title").trim(),
    company: data.get("company").trim(),
    url: data.get("url").trim(),
    location: data.get("location").trim(),
    dateApplied: data.get("dateApplied"),
    status: data.get("status"),
    source: data.get("source").trim(),
    salary: data.get("salary").trim(),
    contact: data.get("contact").trim(),
    notes: data.get("notes").trim(),
    // Comments start empty; they're edited later on the tracker page.
    comments: "",
    // When the record was created, useful for sorting.
    createdAt: new Date().toISOString(),
  };

  try {
    await addJob(job);
    showMessage("Saved!", "success");

    // Clear the form for the next job, then put the defaults back.
    form.reset();
    statusSelect.value = "Applied";
    document.getElementById("dateApplied").value = todayString();
    checkDuplicate(); // hides the warning and resets the button
  } catch (error) {
    // If something goes wrong (rare), tell the user instead of failing silently.
    showMessage("Could not save: " + error.message, "error");
  }
});

// Show a short message under the button. "type" picks the colour (see CSS).
function showMessage(text, type) {
  message.textContent = text;
  message.className = type;
}

// --- 5. Open the tracker page -----------------------------------------------
// Links inside a popup don't behave like normal web links, so we open the
// page ourselves in a new tab. chrome.runtime.getURL turns "tracker.html"
// into the extension's full address (chrome-extension://<id>/tracker.html).
// Opening our own extension page needs no extra permission.
document.getElementById("open-tracker").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("tracker.html") });
  window.close(); // close the popup
});
