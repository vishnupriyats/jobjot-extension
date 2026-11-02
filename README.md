# JobJot – Job Application Tracker (Chrome extension)

Save job applications from your browser toolbar and view them all in one table or board.

## Installing

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right switch).
3. Click **Load unpacked** and choose this folder.
4. Pin the extension: click the puzzle-piece icon in the toolbar, then the pin next to **JobJot**.
5. **Turn on notifications for Chrome**, or you won't see follow-up reminders (see below).

> [!IMPORTANT]
> **Follow-up reminders need your computer to allow Chrome notifications.** This is often off, and when it is, reminders are dropped silently: no error, no popup. The orange **Follow up** tag still appears on the tracker page, which is a sign the extension is working but your computer is hiding the notification.
>
> **macOS**
> 1. Open **System Settings → Notifications**.
> 2. Click **Google Chrome** and turn on **Allow notifications**.
> 3. Choose **Alerts** (stay on screen until you click them, recommended) or **Banners** (disappear after a few seconds).
> 4. If there is also an entry called **Google Chrome (Alerts)** or similar, turn that on too.
> 5. Quit and reopen Chrome if notifications still don't appear.
>
> **Windows**
> 1. Open **Settings → System → Notifications**.
> 2. Make sure **Notifications** is on, then find **Google Chrome** in the list and turn it on.
>
> **Both:** make sure **Focus / Do Not Disturb** is off, as it hides all notifications.
>
> To check it works, see [Testing the reminders](#testing-the-reminders).

## Files

| File | What it does |
| --- | --- |
| `manifest.json` | Tells Chrome about the extension (see below). |
| `popup.html` / `popup.css` / `popup.js` | The small window that opens when you click the toolbar icon: the "save a job" form. |
| `extract.js` | Reads the job title, company, location and salary from the job page you're on, to pre-fill the popup. |
| `tracker.html` / `tracker.css` / `tracker.js` | Full page listing every saved job, as a table or as a board. |
| `background.js` | Runs in the background and shows a follow-up reminder 10 days after you apply. |
| `storage.js` | Shared helpers for reading/writing jobs in `chrome.storage.local`. |
| `csv.js` | Converts jobs to and from CSV text, for the tracker page's Export/Import buttons. |
| `styles.css` | Colours and fonts shared by both pages (with dark mode). |
| `icons/` | The extension icon (a white briefcase on blue) at 16, 32, 48 and 128 pixels. |
| `tools/make_icons.py` | Python script that draws the icons. Not used by Chrome; only needed to change the icon. |
| `store-assets/` | Images for the Chrome Web Store listing, such as `store-icon-128.png`. Not part of the extension itself. |

## About `manifest.json`

JSON files can't contain comments, so here is what each line means:

- `"manifest_version": 3` — use Chrome's current extension format (Manifest V3).
- `"name"`, `"version"`, `"description"` — shown on the `chrome://extensions` page.
- `"permissions": ["storage", "activeTab", "scripting", "alarms", "notifications"]`
  - `storage` lets the extension save jobs with `chrome.storage.local`. The data stays on your computer.
  - `activeTab` gives the popup access to the tab you were on **when you clicked the icon**, and only that tab, only at that moment. It gives no access to any other tab or site.
  - `alarms` lets `background.js` wake up once an hour to check for jobs to follow up on.
  - `notifications` lets it show the follow-up reminder on your desktop.
  - `scripting` lets the popup run `extract.js` inside that tab to read the job details from the page. Because of `activeTab`, it can only do this on the page you clicked the icon on; it can't read pages in the background.
- `"background"` — `background.js` runs in the background (a "service worker") even when the popup and tracker page are closed. It is what shows the follow-up reminders.
- `"icons"` — the extension's icon at several sizes. Chrome picks the best one for each place: 16 px in the toolbar and favicon, 32 px on high-resolution screens, 48 px on the `chrome://extensions` page, and 128 px when installing or in the Chrome Web Store.
- `"action"` — the toolbar button. `default_popup` is the page shown when you click it, and `default_icon` is the picture on the button.

To change the icon, either:

- edit the shapes or colours in `tools/make_icons.py`, then run `python3 tools/make_icons.py` from the project folder (it uses only built-in Python, nothing to install), or
- replace the PNG files in `icons/` with your own square images, keeping the same file names and sizes.

The script also redraws `store-assets/store-icon-128.png`, the icon for the Chrome Web Store listing: the same design at 96×96 pixels with 16 pixels of empty space around it, as the store asks.

Then reload the extension on `chrome://extensions`.

## Where the data lives

All jobs are stored in `chrome.storage.local` under a single key, `jobs`, as an array of objects. Removing the extension deletes the data, so use **Export CSV** to keep a backup.

## Auto-fill from job pages

When you open the popup on a job posting, it tries to fill in the job title, company, location, salary and source (e.g. "LinkedIn"). It looks, in order, at:

1. **Structured job data** that most job sites put in the page for Google (Greenhouse, Lever, Workday, Indeed, Glassdoor and many company career pages). This is the most reliable.
2. **LinkedIn and Indeed page elements**, for their signed-in pages. These sites change their pages now and then, so this part may need updating.
3. **The tab title**, e.g. "Data Analyst | Acme | LinkedIn". This is a guess.

Always check the fields before saving. On LinkedIn's job search page, the saved URL is changed to the job's own page (`linkedin.com/jobs/view/…`) rather than the search results.

## Table and board views

The tracker page has a **Table / Board** switch, and remembers the one you picked.

- **Table:** every detail, the editable Comments box, and Edit / Delete buttons.
- **Board:** one column per status. Drag a card to another column to change its status, or use the dropdown on the card. Each card has an Edit button.

## Editing a job

Click **Edit** on a row or card to change any field: title, company, URL, dates, status, notes, comments and so on. **Esc** or **Cancel** closes the window without saving.

- Changing **Date applied** restarts the follow-up reminder from the new date.
- A date imported in another format (like `10/24/2026`) shows as blank in the date picker, with a note. Pick the right date to fix it, or leave it blank to keep the old text.

## Search and filter

Above the table/board:

- **Search** looks in the title, company, location, source, salary, contact, notes, comments and URL, ignoring upper/lower case. With several words, every word must appear somewhere in the job: `analyst berlin` finds Data Analyst jobs located in Berlin.
- **Status filter** shows one status only, or **Needs follow-up** for jobs at Applied for 10+ days.

The header shows e.g. "3 of 40 jobs" while filtering. **Export CSV** always exports all jobs, not just the ones shown.

## Duplicate warning

If the job in the popup looks like one you've already saved, the popup shows *"Already saved: "Data Analyst" at Acme (Applied, applied 2026-10-12)"* with a **View in tracker** link, which opens the tracker already searching for it.

A job counts as already saved if it has:

- the **same URL**, ignoring `www.`, a trailing `/`, `#…` and tracking parts like `?utm_source=…` or LinkedIn's `?trackingId=…`, or
- the **same title and company** (ignoring upper/lower case).

You can still save it (for example if you're re-applying): the first click turns the button into **Save anyway**, and the second click saves.

## Follow-up reminders

If a job is still marked **Applied** 10 days after its "Date applied", you get a desktop notification: *"You applied to Data Analyst at Acme 10 days ago…"*, with two buttons:

- **Remind me in 3 days** shows it again in 3 days, if the job is still at Applied by then.
- **Open tracker** opens the tracker page. Clicking the notification itself does the same.

Each job is reminded once (unless you snooze it). Changing the status to anything else, such as Interview, Rejected or Ghosted, stops the reminders. If more than 3 jobs are due at once (for example right after importing old jobs) you get one summary notification instead of many.

The check runs once an hour and when Chrome starts, so a reminder can arrive up to an hour after it's due, and only while Chrome is running. On the tracker page, the same jobs show an orange **Follow up** tag.

Only dates in `YYYY-MM-DD` format are checked (so not dates imported as `10/24/2026`). To change the 10 or 3 days, edit `FOLLOW_UP_DAYS` or `SNOOZE_DAYS` at the "Follow-up reminders" section in `storage.js`.

Reminders only appear if your computer allows Chrome notifications. See the **Turn on notifications** box under [Installing](#installing).

### Testing the reminders

You don't have to wait 10 days:

1. In the popup, save a test job with **Status: Applied** and **Date applied** set to 11 or more days ago.
2. On `chrome://extensions`, click the ↻ reload button on JobJot. Reloading runs the check immediately.
3. A notification should appear within a few seconds, and the job gets a **Follow up** tag on the tracker page.

Each job only reminds you once. To run the test again, click **service worker** on the JobJot card on `chrome://extensions` and paste this in the console that opens. It shows a plain test notification, resets every job's "already reminded" flag and runs the check again:

```js
(async () => {
  const jobs = await getJobs();
  console.table(jobs.map(j => ({ title: j.title, status: j.status, dateApplied: j.dateApplied,
    reminded: j.reminded, snoozeUntil: j.snoozeUntil, dueNow: isReminderDue(j) })));
  console.log("Chrome notification permission:", await chrome.notifications.getPermissionLevel());
  await chrome.notifications.create("test", { type: "basic", iconUrl: "icons/icon128.png",
    title: "JobJot test", message: "If you can see this, notifications work." });
  await setJobs(jobs.map(j => ({ ...j, reminded: false, snoozeUntil: "" })));
  await checkFollowUps();
  console.log("Done – you should see the test notification plus any reminders.");
})().catch(e => console.error("Error:", e));
```

Delete the test jobs from the tracker page afterwards.

### Not seeing notifications?

| What you see | What it means / what to do |
| --- | --- |
| **Follow up** tag shows, but no notification | The extension is working; your computer is hiding the notification. Turn on Chrome notifications (see [Installing](#installing)), check Focus / Do Not Disturb, then quit and reopen Chrome. Then run the test above, because the reminder was already marked as shown. |
| The test notification doesn't appear either | Same as above: it's the system notification setting, not the extension. |
| Red error in the service worker console | Something is broken in the extension; the error message says what. |
| No **service worker** link on the JobJot card | `background.js` didn't load. Click the **Errors** button on the card to see why. |
| No **Follow up** tag either | The job isn't due: it must be at **Applied** with a date applied 10+ days ago, written as `YYYY-MM-DD`. |

## Notes vs. comments

- **Notes** are typed in the popup when you save a job.
- **Comments** are edited right in the tracker table, at any time (for example "Recruiter called 10/25, second round next week"). Click the box in the Comments column and type; it saves automatically.

## CSV export and import

On the tracker page:

- **Export CSV** downloads every job as `jobjot-YYYY-MM-DD.csv`, which opens in Excel, Numbers or Google Sheets.
- **Import CSV** adds the jobs from a CSV file to the ones already saved. It never deletes or changes existing jobs.

Import notes:

- The first row must be column headings. Columns are matched by name (`Job title`, `Company`, `Status`, …, as in an exported file), in any order and any upper/lower case; missing columns are left blank. At least `Job title` or `Company` must be present.
- Rows whose `ID` matches a job you already have are skipped, so re-importing an exported file doesn't create duplicates. Rows without an `ID` always get added as new jobs.
- An unknown or empty `Status` becomes `Saved`.
- Dates should be `YYYY-MM-DD` so the table sorts correctly. Excel may change them to something like `10/24/2026` when you save; those are kept as written.
- Values starting with `=`, `+`, `-` or `@` are exported with a leading `'` so spreadsheets don't run them as formulas; import removes it again.
