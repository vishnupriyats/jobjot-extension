// extract.js
// -----------------------------------------------------------------------------
// extractJobDetails() reads the job title, company, location and salary from a
// job posting page. popup.js runs it INSIDE the tab you're looking at, using
// chrome.scripting.executeScript (this needs the "scripting" permission, and
// "activeTab" limits it to the tab you were on when you clicked the icon).
//
// Important: Chrome copies just this one function into the page, so it can't
// use anything defined elsewhere in the extension (storage.js etc.). Every
// helper it needs is defined inside it.
//
// Where the details come from, best first:
//   1. Structured data. Most job sites (Greenhouse, Lever, Workday, Indeed,
//      Glassdoor, many company career pages) include a hidden block of JSON
//      describing the job in a standard format (schema.org "JobPosting"),
//      mainly so Google can list the job. It's the most reliable source.
//   2. Site-specific page elements for LinkedIn and Indeed, whose signed-in
//      pages often don't include that JSON. (Sites change their pages from
//      time to time, so these may stop working; step 3 is the fallback.)
//   3. A guess from the tab title, e.g. "Data Analyst | Acme | LinkedIn".
// Anything not found is left out, and you can always edit the form.
// -----------------------------------------------------------------------------

function extractJobDetails() {
  const result = {};

  // Squash runs of spaces/line breaks into one space and trim the ends.
  const clean = (text) => (typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "");

  // Structured data sometimes contains HTML codes like "&amp;" for "&".
  // DOMParser turns them back into characters (it never runs any scripts).
  const decode = (text) =>
    clean(new DOMParser().parseFromString(text, "text/html").documentElement.textContent);

  // Text of the first element matching any of the CSS selectors, or "".
  const textOf = (...selectors) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && clean(element.textContent)) return clean(element.textContent);
    }
    return "";
  };

  // Fill a field only if we don't have it yet, so earlier sources win.
  const set = (field, value) => {
    if (!result[field] && value) result[field] = value;
  };

  // --- 1. Structured data (schema.org JobPosting) ----------------------------
  const posting = findJobPosting();
  if (posting) {
    set("title", decode(posting.title || ""));
    const org = posting.hiringOrganization;
    set("company", decode(typeof org === "string" ? org : (org && org.name) || ""));
    set("location", postingLocation(posting));
    set("salary", postingSalary(posting.baseSalary));
  }

  // Look through every JSON block on the page for one describing a job.
  function findJobPosting() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue; // badly formed JSON: skip it
      }
      // The job may be on its own, in a list, or inside an "@graph" list.
      const items = [].concat(data, (data && data["@graph"]) || []);
      const job = items.find((item) => item && [].concat(item["@type"]).includes("JobPosting"));
      if (job) return job;
    }
    return null;
  }

  // "Remote", or a place like "Berlin, Germany", or several joined with " / ".
  function postingLocation(job) {
    if (job.jobLocationType === "TELECOMMUTE") return "Remote";
    const places = [].concat(job.jobLocation || []).map((place) => {
      const address = place && place.address;
      if (typeof address === "string") return clean(address);
      if (!address) return clean(place && place.name);
      const country = address.addressCountry;
      return [address.addressLocality, address.addressRegion,
              typeof country === "object" && country ? country.name : country]
        .map(clean).filter(Boolean).join(", ");
    });
    // Remove empty and repeated places.
    return [...new Set(places.filter(Boolean))].join(" / ");
  }

  // Something like "$90,000–110,000 / year".
  function postingSalary(salary) {
    if (!salary || typeof salary !== "object") return "";
    const value = salary.value;
    const amount = (number) => {
      if (number === undefined || number === null || number === "" || isNaN(Number(number))) return "";
      try {
        return new Intl.NumberFormat(undefined, {
          style: salary.currency ? "currency" : "decimal",
          currency: salary.currency || undefined,
          maximumFractionDigits: 0,
        }).format(Number(number));
      } catch {
        return String(number); // unknown currency code
      }
    };
    let text;
    if (typeof value === "object" && value) {
      const min = amount(value.minValue);
      const max = amount(value.maxValue);
      text = min && max && min !== max ? `${min}–${max}` : min || max || amount(value.value);
    } else {
      text = amount(value);
    }
    if (!text) return "";
    const unit = clean((typeof value === "object" && value && value.unitText) || salary.unitText || "");
    return unit ? `${text} / ${unit.toLowerCase()}` : text;
  }

  // --- 2. Site-specific page elements -----------------------------------------
  const host = location.hostname.replace(/^www\./, "");

  if (host.endsWith("linkedin.com")) {
    set("title", textOf(".job-details-jobs-unified-top-card__job-title h1",
                        ".job-details-jobs-unified-top-card__job-title",
                        ".top-card-layout__title"));
    set("company", textOf(".job-details-jobs-unified-top-card__company-name a",
                          ".job-details-jobs-unified-top-card__company-name",
                          ".topcard__org-name-link"));
    set("location", textOf(".job-details-jobs-unified-top-card__primary-description-container .tvm__text",
                           ".topcard__flavor--bullet"));
    // On the job search page the address is something like
    // /jobs/search/?currentJobId=123. Save the job's own page instead.
    const jobId = new URLSearchParams(location.search).get("currentJobId");
    if (jobId && /^\d+$/.test(jobId)) result.url = `https://www.linkedin.com/jobs/view/${jobId}/`;
  }

  if (/(^|\.)indeed\./.test(host)) {
    // Indeed sometimes adds " - job post" to the end of the title.
    set("title", textOf('[data-testid="jobsearch-JobInfoHeader-title"]').replace(/\s*-\s*job post$/i, ""));
    set("company", textOf('[data-testid="inlineHeader-companyName"]'));
    set("location", textOf('[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'));
  }

  // --- 3. Guess from the tab title ---------------------------------------------
  if (!result.title || !result.company) {
    let pageTitle = clean(document.title)
      // Drop a job board's name from the end, e.g. "... | LinkedIn".
      .replace(/\s*[|\-–—]\s*(LinkedIn|Indeed(\.com)?|Glassdoor|ZipRecruiter|Wellfound|Dice|Monster)$/i, "")
      // Greenhouse pages start with "Job Application for ...".
      .replace(/^Job Application for\s+/i, "");

    let guessTitle = pageTitle;
    let guessCompany = "";
    const atMatch = pageTitle.match(/^(.+?)\s+at\s+(.+)$/);  // "Engineer at Acme"
    const parts = pageTitle.split(/\s+[|–—-]\s+/);            // "Engineer | Acme"
    if (atMatch) {
      [, guessTitle, guessCompany] = atMatch;
    } else if (parts.length >= 2) {
      [guessTitle, guessCompany] = parts;
    }
    set("title", clean(guessTitle));
    set("company", clean(guessCompany));
  }

  // --- Source: which job board this is ------------------------------------------
  const boards = {
    "linkedin.com": "LinkedIn",
    "indeed.com": "Indeed",
    "glassdoor.com": "Glassdoor",
    "ziprecruiter.com": "ZipRecruiter",
    "wellfound.com": "Wellfound",
    "dice.com": "Dice",
    "monster.com": "Monster",
    "welcometothejungle.com": "Welcome to the Jungle",
  };
  for (const [domain, name] of Object.entries(boards)) {
    if (host === domain || host.endsWith("." + domain)) set("source", name);
  }
  // Indeed has a site per country (indeed.co.uk, uk.indeed.com, ca.indeed.com...).
  if (/(^|\.)indeed\./.test(host)) set("source", "Indeed");

  return result;
}
