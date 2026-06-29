# HOA Tracker — Setup Instructions

## What you're getting

| File | Purpose |
|------|---------|
| `HOA_Tracker_Data.csv` | All 12 action items, pre-loaded, ready to import |
| `HOA_Tracker_AppsScript.js` | Full automation: alerts, digest, change log, audit trail |

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it: **HOA Board ↔ Management Tracker**
3. In the sheet tab at the bottom, rename `Sheet1` → **Tracker**

---

## Step 2 — Import the CSV

1. With the **Tracker** sheet active: **File → Import**
2. Upload `HOA_Tracker_Data.csv`
3. Choose **Replace current sheet**, separator: **Comma**, uncheck "Convert text to numbers/dates"
4. Click **Import data**

---

## Step 3 — Add the Apps Script

1. **Extensions → Apps Script**
2. Delete the default `function myFunction() {}` placeholder
3. Paste the entire contents of `HOA_Tracker_AppsScript.js`
4. Click **Save** (the floppy disk icon), name the project **HOA Tracker**

---

## Step 4 — Edit email addresses

At the top of the script, update the `CONFIG` block:

```js
BOD_EMAILS: [
  "yourname@example.com",        // ← Board member 1
  "boardmember2@example.com",    // ← Board member 2
  "boardmember3@example.com",    // ← Board member 3
],
HSM_EMAIL: "hsm.contact@example.com",  // ← HSM contact
```

Save again after editing.

---

## Step 5 — Run setup (once)

1. In the Apps Script editor, select **setupSpreadsheet** from the function dropdown
2. Click **Run**
3. Grant permissions when prompted (the script needs access to Sheets and Gmail)
4. You'll see a confirmation dialog — click OK

This creates the **Change Log** tab, applies color-coded formatting, adds dropdown validation on Status/Owner/Awaiting BoD columns, and sets warning-only protection on audit columns.

---

## Step 6 — Install triggers (once each)

Back in the Apps Script editor:

- Select **createEditTrigger** → Run  
  *(enables real-time "Awaiting BoD" alerts and change logging)*

- Select **createWeeklyTrigger** → Run  
  *(schedules the Friday 8am digest to all BoD emails)*

---

## Step 7 — Set column-level access permissions

This is the key step for separating what HSM can edit vs. what BoD can edit.

1. In the spreadsheet, select columns **J–K** (BoD Direction / Response + BoD Response Date)
2. **Data → Protect sheets and ranges → Add a range**
3. Description: `BoD direction — BoD editors only`
4. Click **Set permissions → Restrict who can edit this range**
5. Add only the BoD member Google accounts; remove HSM

Repeat for columns **M–N** (Last Updated, Updated By):
- Description: `Audit columns — script only`
- Set permissions: remove all editors (or set to "Only you")

---

## How it works day-to-day

### HSM's responsibilities
- Open the tracker link (share with their Google account as **Editor**)
- Update **Status**, **Notes / History**, **What HSM is waiting on BoD for**
- Flip **Awaiting BoD?** to **Yes** when a decision is needed → BoD gets an automatic email alert

### BoD's responsibilities
- Receive Friday digest every week
- When alerted, open tracker and record decision in **BoD Direction / Response** → HSM gets notified automatically
- Use **HOA Tracker → Send digest now** for an on-demand summary at any time

### Change Log tab
Every edit is automatically logged with: timestamp, item ID, section, title, field changed, old value, new value, and editor email. This is your audit trail for any disputes.

---

## Sharing the spreadsheet

- **HSM**: Editor access (columns J–K and M–N will be protected per Step 7)
- **All BoD members**: Editor access
- **File → Share → Copy link** → set to "Anyone with the link can view" if you want read-only access for other owners (optional)
