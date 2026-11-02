// csv.js
// -----------------------------------------------------------------------------
// Turning jobs into CSV text (for export) and CSV text back into jobs (for
// import). Used by tracker.html, which loads this file after storage.js.
//
// CSV ("comma-separated values") is a plain-text table that Excel, Numbers and
// Google Sheets can all open. The rules we follow:
//   - one line per row, values separated by commas
//   - a value containing a comma, a quote or a line break is wrapped in
//     double quotes, and any quote inside it is doubled:  He said "hi"  ->
//     "He said ""hi"""
// -----------------------------------------------------------------------------

// The columns, in the order they appear in the file. "key" is the field name
// on the job object; "label" is the friendlier column heading in the file.
// On import we accept either one as a heading, in any upper/lower case.
const CSV_COLUMNS = [
  { key: "dateApplied", label: "Date applied" },
  { key: "title", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "url", label: "Job URL" },
  { key: "location", label: "Location" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "salary", label: "Salary" },
  { key: "contact", label: "Contact" },
  { key: "notes", label: "Notes" },
  { key: "comments", label: "Comments" },
  { key: "createdAt", label: "Created at" },
  // The id lets a re-import of an exported file skip jobs you already have.
  { key: "id", label: "ID" },
];

// Spreadsheet apps treat a cell starting with = + - or @ as a formula, which
// a malicious job page title could abuse ("CSV injection"). We put a ' in
// front of such values on export (spreadsheets hide it) and remove it on import.
const FORMULA_START = /^[=+\-@\t\r]/;

// --- Export -----------------------------------------------------------------

// Build the CSV text for a list of jobs, including the heading row.
function jobsToCsv(jobs) {
  const lines = [CSV_COLUMNS.map((column) => csvValue(column.label)).join(",")];
  for (const job of jobs) {
    lines.push(CSV_COLUMNS.map((column) => csvValue(job[column.key])).join(","));
  }
  // Windows-style line endings (\r\n) are what the CSV standard asks for.
  return lines.join("\r\n") + "\r\n";
}

// Prepare one value for a CSV cell.
function csvValue(value) {
  let text = value == null ? "" : String(value);
  if (FORMULA_START.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

// --- Import -----------------------------------------------------------------

// Split CSV text into rows, each an array of strings. Handles quoted values,
// including ones that contain commas, doubled quotes or line breaks.
function parseCsv(text) {
  // Files saved by Excel often start with an invisible "byte order mark".
  if (text.startsWith("﻿")) text = text.slice(1);

  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  // Walk through the text one character at a time.
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"'; // a doubled quote means one real quote
        i++;
      } else if (char === '"') {
        inQuotes = false; // closing quote
      } else {
        value += char; // anything else, even a comma or line break, is text
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      // End of a row. Treat \r\n as a single line break.
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  // The last row, if the file doesn't end with a line break.
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

// Turn CSV text into job objects. Throws an Error with a readable message if
// the file doesn't look like a job list.
function csvToJobs(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("The file is empty.");

  // Work out which column holds which field, from the heading row.
  const headings = rows[0].map((heading) => heading.trim().toLowerCase());
  const columnIndex = {};
  for (const column of CSV_COLUMNS) {
    const index = headings.findIndex(
      (heading) => heading === column.label.toLowerCase() || heading === column.key.toLowerCase()
    );
    if (index !== -1) columnIndex[column.key] = index;
  }
  if (columnIndex.title === undefined && columnIndex.company === undefined) {
    throw new Error('No "Job title" or "Company" column found in the first row.');
  }

  const jobs = [];
  for (const row of rows.slice(1)) {
    // Read one field from this row, or "" if the column is missing.
    const get = (key) => {
      const index = columnIndex[key];
      let text = index === undefined ? "" : (row[index] || "").trim();
      // Undo the ' added on export to stop formulas.
      if (text.startsWith("'") && FORMULA_START.test(text.slice(1))) text = text.slice(1);
      return text;
    };

    // Skip blank lines (spreadsheets sometimes add them at the end).
    if (row.every((cell) => cell.trim() === "")) continue;

    jobs.push({
      id: get("id") || crypto.randomUUID(),
      title: get("title"),
      company: get("company"),
      url: get("url"),
      location: get("location"),
      dateApplied: normalizeDate(get("dateApplied")),
      status: normalizeStatus(get("status")),
      source: get("source"),
      salary: get("salary"),
      contact: get("contact"),
      notes: get("notes"),
      comments: get("comments"),
      createdAt: get("createdAt") || new Date().toISOString(),
    });
  }
  return jobs;
}

// Match a status case-insensitively ("offer" -> "Offer"). Anything unknown
// becomes "Saved" so every row still gets a valid dropdown value.
function normalizeStatus(text) {
  const match = STATUSES.find((status) => status.toLowerCase() === text.toLowerCase());
  return match || "Saved";
}

// Keep dates as "YYYY-MM-DD" so the table sorts correctly. "2026/10/24" is
// converted; other formats (like "10/24/2026") are kept as typed, because we
// can't tell whether the month or the day comes first.
function normalizeDate(text) {
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return text;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
