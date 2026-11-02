// tracker.js
// -----------------------------------------------------------------------------
// Code for tracker.html. It reads all saved jobs from chrome.storage.local and
// draws them, newest first, in one of two views:
//   - Table: one row per job, with a Status dropdown (to change the status in
//     place), a Comments box you can edit at any time, and Edit/Delete buttons.
//   - Board: one column per status; drag a card to change its status.
// The header has a Table/Board switch and buttons to export all jobs to a CSV
// file and import jobs from one. Above the jobs, a search box and a status
// filter narrow down which jobs are shown. Edit opens a window (a <dialog>)
// for changing every field of a job.
//
// Jobs waiting 10+ days at "Applied" get a "Follow up" tag (background.js
// shows the matching desktop notification).
//
// getJobs(), setJobs(), updateJob(), deleteJob(), STATUSES, JOBS_KEY,
// todayString(), needsFollowUp() and daysBetween() come from storage.js;
// jobsToCsv() and csvToJobs() from csv.js.
// -----------------------------------------------------------------------------

const tableBody = document.getElementById("jobs-body");
const tableWrap = document.getElementById("table-wrap");
const board = document.getElementById("board");
const emptyMessage = document.getElementById("empty");
const noMatchesMessage = document.getElementById("no-matches");
const countText = document.getElementById("count");
const toolbar = document.getElementById("toolbar");
const searchBox = document.getElementById("search");
const statusFilter = document.getElementById("status-filter");

// Read the jobs and (re)draw the whole table or board.
async function renderJobs() {
  const allJobs = await getJobs();

  // Sort newest first: by date applied, then by when the record was created.
  // localeCompare works here because the dates are "YYYY-MM-DD" strings.
  allJobs.sort((a, b) =>
    (b.dateApplied || "").localeCompare(a.dateApplied || "") ||
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );

  // Only the jobs matching the search box and status filter are drawn.
  const jobs = allJobs.filter(matchesFilters);
  const filtering = jobs.length !== allJobs.length;

  // Show exactly one of: "no jobs yet", "no matches", or the table/board.
  const hasJobs = allJobs.length > 0;
  const showJobs = jobs.length > 0;
  emptyMessage.hidden = hasJobs;
  toolbar.hidden = !hasJobs;
  noMatchesMessage.hidden = !hasJobs || showJobs;
  tableWrap.hidden = !showJobs || currentView !== "table";
  board.hidden = !showJobs || currentView !== "board";

  const total = allJobs.length === 1 ? "1 job" : `${allJobs.length} jobs`;
  countText.textContent = filtering ? `${jobs.length} of ${total}` : total;
  // Nothing to export from an empty list. (Export always saves ALL jobs,
  // not just the ones currently shown.)
  exportButton.disabled = !hasJobs;

  if (currentView === "board") {
    renderBoard(jobs);
    return;
  }

  // Redrawing replaces every row, which would throw you out of a Comments box
  // you're typing in. So first remember which box has focus, what's in it
  // (it may not be saved yet) and where the cursor is...
  const focused = document.activeElement;
  const typing = focused && focused.classList.contains("comments-input")
    ? { id: focused.dataset.jobId, value: focused.value,
        start: focused.selectionStart, end: focused.selectionEnd }
    : null;

  // Remove any old rows, then add one new row per job.
  tableBody.replaceChildren();
  for (const job of jobs) {
    tableBody.appendChild(buildRow(job));
  }

  // ...then put it all back in the new box for the same job.
  if (typing) {
    const box = [...tableBody.querySelectorAll(".comments-input")]
      .find((element) => element.dataset.jobId === typing.id);
    if (box) {
      box.value = typing.value;
      box.focus();
      box.setSelectionRange(typing.start, typing.end);
    }
  }
}

// Create one <tr> (table row) for a job.
//
// Safety note: we always use textContent (never innerHTML) to put saved text
// on the page. textContent shows text exactly as typed, so a note containing
// something like "<script>" can't turn into real code.
function buildRow(job) {
  const row = document.createElement("tr");

  // Small helper: add a <td> cell containing plain text.
  function addTextCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text || "";
    row.appendChild(cell);
    return cell;
  }

  const dateCell = addTextCell(job.dateApplied);
  if (needsFollowUp(job)) dateCell.appendChild(buildFollowUpTag(job));

  const titleCell = document.createElement("td");
  titleCell.appendChild(buildTitle(job));
  row.appendChild(titleCell);

  addTextCell(job.company);
  addTextCell(job.location);

  const statusCell = document.createElement("td");
  statusCell.appendChild(buildStatusSelect(job));
  row.appendChild(statusCell);

  addTextCell(job.source);
  addTextCell(job.salary);
  addTextCell(job.contact);
  addTextCell(job.notes).className = "notes";

  // Comments: a text box you can edit at any time. It saves while you type
  // (half a second after you stop) and again when you leave the box.
  const commentsCell = document.createElement("td");
  const commentsBox = document.createElement("textarea");
  commentsBox.className = "comments-input";
  commentsBox.rows = 2;
  commentsBox.value = job.comments || "";
  commentsBox.placeholder = "Add a comment…";
  // Lets renderJobs() find this box again after a redraw.
  commentsBox.dataset.jobId = job.id;
  commentsBox.setAttribute("aria-label", `Comments for ${job.title} at ${job.company}`);

  let saveTimer;
  const saveComments = () => {
    clearTimeout(saveTimer);
    updateJob(job.id, { comments: commentsBox.value });
  };
  commentsBox.addEventListener("input", () => {
    // Restart the half-second countdown on every key press, so we save once
    // after a pause instead of on every single letter.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveComments, 500);
  });
  // "change" fires when you leave the box after editing: save right away.
  commentsBox.addEventListener("change", saveComments);
  commentsCell.appendChild(commentsBox);
  row.appendChild(commentsCell);

  // Edit and Delete buttons.
  const actionCell = document.createElement("td");
  actionCell.className = "actions";
  actionCell.appendChild(buildEditButton(job));

  const deleteButton = document.createElement("button");
  deleteButton.textContent = "Delete";
  deleteButton.className = "delete";
  deleteButton.addEventListener("click", async () => {
    // confirm() shows a simple OK/Cancel box. Stop if they click Cancel.
    if (!confirm(`Delete "${job.title}" at ${job.company}?`)) return;
    await deleteJob(job.id);
    // No need to redraw here: the storage listener below does it for us.
  });
  actionCell.appendChild(deleteButton);
  row.appendChild(actionCell);

  return row;
}

// --- Pieces shared by the table and the board -------------------------------

// A small "Edit" button that opens the Edit job window for this job.
function buildEditButton(job) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Edit";
  button.className = "edit";
  button.setAttribute("aria-label", `Edit ${job.title} at ${job.company}`);
  button.addEventListener("click", () => openEditDialog(job));
  return button;
}

// The job title: a clickable link if a URL was saved, otherwise plain text.
function buildTitle(job) {
  if (!isWebLink(job.url)) {
    const span = document.createElement("span");
    span.textContent = job.title || "";
    return span;
  }
  const link = document.createElement("a");
  link.href = job.url;
  link.textContent = job.title || job.url;
  link.target = "_blank";          // open in a new tab
  link.rel = "noopener noreferrer"; // don't give that page access to ours
  return link;
}

// Status: a dropdown, so you can change it in place. It's styled as a
// coloured "badge"; the CSS class (e.g. status-offer) picks the colour.
// See tracker.css.
function buildStatusSelect(job) {
  const statusSelect = document.createElement("select");
  statusSelect.className = "badge status-" + (job.status || "").toLowerCase();
  // Screen readers read this label, since the dropdown has no visible one.
  statusSelect.setAttribute("aria-label", `Status for ${job.title} at ${job.company}`);
  for (const status of STATUSES) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    statusSelect.appendChild(option);
  }
  statusSelect.value = job.status;
  // Save as soon as a new status is picked. The storage listener at the
  // bottom of this file then redraws the page with the new colour.
  statusSelect.addEventListener("change", async () => {
    await updateJob(job.id, { status: statusSelect.value });
  });
  return statusSelect;
}

// A small "Follow up" tag for jobs that have been at "Applied" for
// FOLLOW_UP_DAYS or more (see needsFollowUp() in storage.js). Hovering shows
// how long ago you applied.
function buildFollowUpTag(job) {
  const tag = document.createElement("span");
  tag.className = "follow-up";
  tag.textContent = "Follow up";
  tag.title = `Applied ${daysBetween(job.dateApplied, todayString())} days ago with no change in status`;
  return tag;
}

// --- Board view ---------------------------------------------------------------
// One column per status, with a card per job. Drag a card to another column to
// change its status. (The dropdown on each card does the same thing, for
// people using a keyboard.)

// Draw the board. "jobs" is already sorted newest first.
function renderBoard(jobs) {
  board.replaceChildren();

  for (const status of STATUSES) {
    const jobsHere = jobs.filter((job) => job.status === status);

    const column = document.createElement("section");
    column.className = "board-column";

    const heading = document.createElement("h2");
    heading.className = "status-" + status.toLowerCase();
    heading.textContent = status;
    const count = document.createElement("span");
    count.className = "column-count";
    count.textContent = jobsHere.length;
    heading.appendChild(count);
    column.appendChild(heading);

    for (const job of jobsHere) {
      column.appendChild(buildCard(job));
    }

    // Drag and drop. The browser only allows dropping onto an element whose
    // "dragover" handler calls preventDefault().
    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      column.classList.add("drop-target"); // highlight (see tracker.css)
    });
    column.addEventListener("dragleave", (event) => {
      // dragleave also fires when moving over a card INSIDE the column, so
      // only remove the highlight when the pointer really leaves the column.
      if (!column.contains(event.relatedTarget)) column.classList.remove("drop-target");
    });
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      column.classList.remove("drop-target");
      const id = event.dataTransfer.getData("text/plain");
      if (id) await updateJob(id, { status });
    });

    board.appendChild(column);
  }
}

// Create one card for the board.
function buildCard(job) {
  const card = document.createElement("article");
  card.className = "card";
  card.draggable = true;
  card.addEventListener("dragstart", (event) => {
    // Remember WHICH job is being dragged; the drop handler reads it back.
    event.dataTransfer.setData("text/plain", job.id);
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  const title = document.createElement("h3");
  title.appendChild(buildTitle(job));
  card.appendChild(title);

  // Company, location and date, each on its own line, skipping empty ones.
  for (const text of [job.company, job.location, job.dateApplied]) {
    if (!text) continue;
    const line = document.createElement("p");
    line.textContent = text;
    card.appendChild(line);
  }

  if (needsFollowUp(job)) card.appendChild(buildFollowUpTag(job));

  // Status dropdown and Edit button side by side at the bottom of the card.
  const footer = document.createElement("div");
  footer.className = "card-footer";
  footer.appendChild(buildStatusSelect(job));
  footer.appendChild(buildEditButton(job));
  card.appendChild(footer);
  return card;
}

// --- Search and status filter ---------------------------------------------------

// Fill the status filter with one option per status, after "All statuses"
// and "Needs follow-up" (which are written in tracker.html).
for (const status of STATUSES) {
  const option = document.createElement("option");
  option.value = status;
  option.textContent = status;
  statusFilter.appendChild(option);
}

// Does this job match the search box and the status filter?
// The search ignores upper/lower case, and with several words, every word
// must appear somewhere in the job: "analyst berlin" finds a Data Analyst job
// located in Berlin.
function matchesFilters(job) {
  const filter = statusFilter.value;
  if (filter === "follow-up" && !needsFollowUp(job)) return false;
  if (filter && filter !== "follow-up" && job.status !== filter) return false;

  const words = searchBox.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const searchable = [job.title, job.company, job.location, job.source, job.salary,
                      job.contact, job.notes, job.comments, job.url]
    .join(" ").toLowerCase();
  return words.every((word) => searchable.includes(word));
}

// Redraw as you type or pick a filter.
searchBox.addEventListener("input", renderJobs);
statusFilter.addEventListener("change", renderJobs);

document.getElementById("clear-filters").addEventListener("click", () => {
  searchBox.value = "";
  statusFilter.value = "";
  renderJobs();
  searchBox.focus();
});

// The popup's "View in tracker" link opens tracker.html?q=<words> to search
// for a job straight away.
searchBox.value = new URLSearchParams(location.search).get("q") || "";

// --- Edit job window -----------------------------------------------------------

const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editDateNote = document.getElementById("edit-date-note");
// The fields the window can change; each matches an input's "name" in tracker.html.
const EDIT_FIELDS = ["title", "company", "url", "location", "dateApplied", "status",
                     "source", "salary", "contact", "notes", "comments"];
// The job the window was last opened for. (Deliberately NOT cleared when the
// window closes: the browser sends its "close" event a moment later, which
// could wipe the job out of a window you've just reopened.)
let editingJob = null;

// Fill the window's Status dropdown.
const editStatus = document.getElementById("edit-status");
for (const status of STATUSES) {
  const option = document.createElement("option");
  option.value = status;
  option.textContent = status;
  editStatus.appendChild(option);
}

// Open the window with this job's current values filled in.
function openEditDialog(job) {
  editingJob = job;
  for (const name of EDIT_FIELDS) {
    editForm.elements[name].value = job[name] || "";
  }

  // A date picker can only show "YYYY-MM-DD" dates. For a date imported in
  // another format (e.g. "10/24/2026") it shows blank, so explain why.
  const oddDate = Boolean(job.dateApplied) && !isIsoDate(job.dateApplied);
  editDateNote.hidden = !oddDate;
  editDateNote.textContent = oddDate
    ? `Saved as "${job.dateApplied}". Pick the date to replace it, or leave it blank to keep it.`
    : "";

  editDialog.showModal();
  editForm.elements.title.focus();
}

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(editForm);

  const changes = {};
  for (const name of EDIT_FIELDS) {
    changes[name] = (data.get(name) || "").trim();
  }
  // Left blank on an odd imported date: keep the old one (see above).
  if (!changes.dateApplied && editingJob.dateApplied && !isIsoDate(editingJob.dateApplied)) {
    changes.dateApplied = editingJob.dateApplied;
  }
  // A new date applied restarts the follow-up reminder (see background.js).
  if (changes.dateApplied !== editingJob.dateApplied) {
    changes.reminded = false;
    changes.snoozeUntil = "";
  }

  await updateJob(editingJob.id, changes);
  // The storage listener at the bottom of this file redraws the page.
  editDialog.close();
});

document.getElementById("edit-cancel").addEventListener("click", () => editDialog.close());

// Is this a "YYYY-MM-DD" date?
function isIsoDate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text);
}

// --- Table / Board switch ------------------------------------------------------

const viewButtons = document.querySelectorAll("[data-view]");

// Which view to show. Remembered in localStorage (a small store each page has
// in the browser) so the tracker opens the way you left it.
let currentView = localStorage.getItem("view") === "board" ? "board" : "table";

function showView(view) {
  currentView = view;
  localStorage.setItem("view", view);
  // aria-pressed tells screen readers which button is "on"; the CSS uses it too.
  for (const button of viewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  renderJobs();
}

for (const button of viewButtons) {
  button.addEventListener("click", () => showView(button.dataset.view));
}
for (const button of viewButtons) {
  button.setAttribute("aria-pressed", String(button.dataset.view === currentView));
}

// Only turn a URL into a link if it starts with http:// or https://.
// This blocks odd links like "javascript:..." from being clickable.
function isWebLink(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

// --- CSV export and import ---------------------------------------------------
// jobsToCsv() and csvToJobs() come from csv.js.

const exportButton = document.getElementById("export-csv");
const importButton = document.getElementById("import-csv");
const importFile = document.getElementById("import-file");
const csvMessage = document.getElementById("csv-message");

// Show a short message under the header. "type" picks the colour (see CSS).
function showCsvMessage(text, type) {
  csvMessage.textContent = text;
  csvMessage.className = type;
}

// Export: build the CSV text and make the browser download it as a file.
// A "Blob" is a file kept in memory; a temporary link with the "download"
// attribute saves it. This needs no extra permission in manifest.json.
exportButton.addEventListener("click", async () => {
  const jobs = await getJobs();
  // "﻿" is an invisible marker that tells Excel the file is UTF-8, so
  // characters like "–" or "é" show correctly.
  const blob = new Blob(["﻿" + jobsToCsv(jobs)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `jobjot-${todayString()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href); // free the memory
  showCsvMessage(`Exported ${jobs.length === 1 ? "1 job" : `${jobs.length} jobs`}.`, "success");
});

// Import: the button opens the hidden file picker...
importButton.addEventListener("click", () => importFile.click());

// ...and once a file is chosen, read it and add its jobs to the saved ones.
importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  // Clear the picker so choosing the same file again still triggers "change".
  importFile.value = "";

  try {
    const imported = csvToJobs(await file.text());
    const jobs = await getJobs();

    // Skip jobs that are already saved (same id), so importing a file you
    // exported earlier doesn't create duplicates.
    const existingIds = new Set(jobs.map((job) => job.id));
    const newJobs = imported.filter((job) => !existingIds.has(job.id));
    const skipped = imported.length - newJobs.length;

    // Save everything in one go. The storage listener below redraws the table.
    await setJobs(jobs.concat(newJobs));

    let text = `Imported ${newJobs.length === 1 ? "1 job" : `${newJobs.length} jobs`}`;
    if (skipped > 0) text += ` (${skipped} already saved, skipped)`;
    showCsvMessage(text + ".", "success");
  } catch (error) {
    showCsvMessage("Could not import: " + error.message, "error");
  }
});

// Redraw automatically whenever the saved jobs change — for example, if you
// save a new job from the popup while this tab is open, or delete one here.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[JOBS_KEY]) {
    renderJobs();
  }
});

// Draw the table once when the page first loads.
renderJobs();
