// ============================================================
// HOA Board ↔ Management Tracker — Google Apps Script
// ============================================================
// SETUP INSTRUCTIONS:
//  1. Import HOA_Tracker_Data.csv into Google Sheets as sheet "Tracker"
//  2. In that spreadsheet: Extensions → Apps Script → paste this file
//  3. Run setupSpreadsheet() once to create the ChangeLog sheet,
//     freeze headers, apply column protection, and format the sheet.
//  4. Run createWeeklyTrigger() once to schedule the Friday digest.
//  5. Run createEditTrigger() once to enable real-time "Awaiting BoD" alerts.
//  6. Update CONFIG below with real email addresses.
// ============================================================

const CONFIG = {
  TRACKER_SHEET:   "Tracker",
  CHANGELOG_SHEET: "Change Log",

  // Email addresses
  BOD_EMAILS: [
    "board.member.1@example.com",
    "board.member.2@example.com",
    "board.member.3@example.com",
  ],
  HSM_EMAIL: "hsm.contact@example.com",

  // Column indices (1-based, matching CSV column order)
  COL: {
    ID:            1,
    SECTION:       2,
    TITLE:         3,
    DESCRIPTION:   4,
    OWNER:         5,
    STATUS:        6,
    DUE_DATE:      7,
    AWAITING_BOD:  8,
    AWAITING_TEXT: 9,
    BOD_RESPONSE:  10,
    BOD_RESP_DATE: 11,
    NOTES:         12,
    LAST_UPDATED:  13,
    UPDATED_BY:    14,
  },

  VALID_STATUSES: ["Not Started", "In Progress", "Overdue", "Complete"],
  VALID_OWNERS:   ["HSM", "BoD", "Joint"],
};

// ── Column letter helper ───────────────────────────────────────
function colLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── One-time setup ─────────────────────────────────────────────
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let tracker = ss.getSheetByName(CONFIG.TRACKER_SHEET);
  if (!tracker) {
    tracker = ss.insertSheet(CONFIG.TRACKER_SHEET);
    SpreadsheetApp.getUi().alert('Created "Tracker" sheet. Import HOA_Tracker_Data.csv into it now, then re-run setupSpreadsheet().');
    return;
  }

  // ── Change Log sheet ────────────────────────────────────────
  let changelog = ss.getSheetByName(CONFIG.CHANGELOG_SHEET);
  if (!changelog) {
    changelog = ss.insertSheet(CONFIG.CHANGELOG_SHEET);
  }
  changelog.clearContents();
  const clHeaders = ["Timestamp", "Item ID", "Section", "Title", "Field Changed", "Old Value", "New Value", "Editor Email"];
  changelog.appendRow(clHeaders);
  changelog.setFrozenRows(1);
  const clHeader = changelog.getRange(1, 1, 1, clHeaders.length);
  clHeader.setBackground("#3c3489").setFontColor("white").setFontWeight("bold");
  changelog.setColumnWidth(1, 160);
  changelog.setColumnWidth(3, 120);
  changelog.setColumnWidth(4, 260);
  changelog.setColumnWidth(5, 140);
  changelog.setColumnWidth(6, 200);
  changelog.setColumnWidth(7, 200);
  changelog.setColumnWidth(8, 200);

  // ── Format Tracker header row ───────────────────────────────
  tracker.setFrozenRows(1);
  const lastCol = Object.keys(CONFIG.COL).length;
  const headerRange = tracker.getRange(1, 1, 1, lastCol);
  headerRange.setBackground("#3c3489").setFontColor("white").setFontWeight("bold");

  // ── Column widths ───────────────────────────────────────────
  tracker.setColumnWidth(CONFIG.COL.ID, 40);
  tracker.setColumnWidth(CONFIG.COL.SECTION, 120);
  tracker.setColumnWidth(CONFIG.COL.TITLE, 260);
  tracker.setColumnWidth(CONFIG.COL.DESCRIPTION, 300);
  tracker.setColumnWidth(CONFIG.COL.OWNER, 80);
  tracker.setColumnWidth(CONFIG.COL.STATUS, 100);
  tracker.setColumnWidth(CONFIG.COL.DUE_DATE, 130);
  tracker.setColumnWidth(CONFIG.COL.AWAITING_BOD, 100);
  tracker.setColumnWidth(CONFIG.COL.AWAITING_TEXT, 260);
  tracker.setColumnWidth(CONFIG.COL.BOD_RESPONSE, 260);
  tracker.setColumnWidth(CONFIG.COL.BOD_RESP_DATE, 110);
  tracker.setColumnWidth(CONFIG.COL.NOTES, 260);
  tracker.setColumnWidth(CONFIG.COL.LAST_UPDATED, 110);
  tracker.setColumnWidth(CONFIG.COL.UPDATED_BY, 160);

  // ── Data validation dropdowns ───────────────────────────────
  const lastRow = Math.max(tracker.getLastRow(), 2);

  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.VALID_STATUSES, true).build();
  tracker.getRange(2, CONFIG.COL.STATUS, lastRow - 1)
    .setDataValidation(statusRule);

  const ownerRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CONFIG.VALID_OWNERS, true).build();
  tracker.getRange(2, CONFIG.COL.OWNER, lastRow - 1)
    .setDataValidation(ownerRule);

  const awaitingRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["Yes", "No"], true).build();
  tracker.getRange(2, CONFIG.COL.AWAITING_BOD, lastRow - 1)
    .setDataValidation(awaitingRule);

  // ── Conditional formatting ──────────────────────────────────
  const statusCol = colLetter(CONFIG.COL.STATUS);
  const awaitCol  = colLetter(CONFIG.COL.AWAITING_BOD);
  const rules = [];
  const range = tracker.getRange(`A2:${colLetter(lastCol)}${lastRow}`);

  // Overdue → light red bg
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$${statusCol}2="Overdue"`)
    .setBackground("#fce8e8").setRanges([range]).build());

  // Complete → light green bg
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$${statusCol}2="Complete"`)
    .setBackground("#e8f5e9").setRanges([range]).build());

  // Awaiting BoD → amber bg
  rules.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$${awaitCol}2="Yes"`)
    .setBackground("#fff3e0").setRanges([range]).build());

  tracker.setConditionalFormatRules(rules);

  // ── Column protection ───────────────────────────────────────
  // Protect audit columns (Last Updated, Updated By) from manual edits
  const auditProtection = tracker.getRange(
    1, CONFIG.COL.LAST_UPDATED, lastRow, 2
  ).protect();
  auditProtection.setDescription("Audit columns — written by script only");
  auditProtection.setWarningOnly(true);

  // Protect BoD Response columns so only BoD editors can write there
  // (Set this manually in Sheets: Range Protection → restrict to specific users)
  // Apps Script can set warning-only here as a reminder:
  const bodProtection = tracker.getRange(
    2, CONFIG.COL.BOD_RESPONSE, lastRow - 1, 2
  ).protect();
  bodProtection.setDescription("BoD direction — BoD editors only");
  bodProtection.setWarningOnly(true);

  SpreadsheetApp.getUi().alert(
    "Setup complete!\n\n" +
    "Next steps:\n" +
    "1. Run createEditTrigger() to enable real-time 'Awaiting BoD' alerts.\n" +
    "2. Run createWeeklyTrigger() to schedule the Friday digest.\n" +
    "3. In Sheets: Data → Protect Sheets & Ranges → set 'BoD Direction' columns to BoD editors only.\n" +
    "4. Update CONFIG.BOD_EMAILS and CONFIG.HSM_EMAIL with real addresses."
  );
}

// ── Trigger installers (run each once manually) ────────────────
function createEditTrigger() {
  // Remove existing onEdit triggers first
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "onTrackerEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("onTrackerEdit")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  Logger.log("onEdit trigger created.");
}

function createWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "sendWeeklyDigest")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("sendWeeklyDigest")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(8)
    .create();
  Logger.log("Weekly Friday 8am digest trigger created.");
}

// ── onEdit handler ─────────────────────────────────────────────
function onTrackerEdit(e) {
  if (!e) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.TRACKER_SHEET) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row < 2) return; // header row

  const ss = sheet.getParent();
  const rowData = sheet.getRange(row, 1, 1, Object.keys(CONFIG.COL).length).getValues()[0];
  const itemId   = rowData[CONFIG.COL.ID - 1];
  const section  = rowData[CONFIG.COL.SECTION - 1];
  const title    = rowData[CONFIG.COL.TITLE - 1];
  const editor   = e.user ? e.user.getEmail() : "unknown";
  const now      = new Date();

  // Determine which field was changed
  const colNames = Object.entries(CONFIG.COL);
  const changedField = (colNames.find(([, v]) => v === col) || ["Unknown"])[0];

  // ── Log to Change Log ───────────────────────────────────────
  const changelog = ss.getSheetByName(CONFIG.CHANGELOG_SHEET);
  if (changelog) {
    changelog.appendRow([
      now, itemId, section, title,
      changedField,
      e.oldValue || "",
      e.value || "",
      editor,
    ]);
  }

  // ── Stamp audit columns ─────────────────────────────────────
  sheet.getRange(row, CONFIG.COL.LAST_UPDATED).setValue(
    Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd")
  );
  sheet.getRange(row, CONFIG.COL.UPDATED_BY).setValue(editor);

  // ── Alert BoD if HSM flips "Awaiting BoD" to Yes ───────────
  if (col === CONFIG.COL.AWAITING_BOD &&
      String(e.value).trim().toLowerCase() === "yes") {
    const awaitingText = rowData[CONFIG.COL.AWAITING_TEXT - 1] || "(no detail provided)";
    const subject = `[HOA Tracker] Action needed: "${title}"`;
    const body =
      `HSM has flagged an item as waiting for Board direction.\n\n` +
      `Item: ${title}\n` +
      `Section: ${section}\n` +
      `What is needed from the Board:\n${awaitingText}\n\n` +
      `Open the tracker to record your direction:\n` +
      `${ss.getUrl()}\n\n` +
      `— HOA Tracker (automated notification)`;
    CONFIG.BOD_EMAILS.forEach(email => {
      try { MailApp.sendEmail(email, subject, body); } catch (err) { Logger.log(err); }
    });
  }

  // ── Notify HSM when BoD records a response ──────────────────
  if (col === CONFIG.COL.BOD_RESPONSE && e.value && e.value.trim() !== "") {
    const response = e.value.trim();
    const subject = `[HOA Tracker] BoD direction recorded: "${title}"`;
    const body =
      `The Board has recorded a direction or decision for the following item.\n\n` +
      `Item: ${title}\n` +
      `Section: ${section}\n` +
      `BoD Direction:\n${response}\n\n` +
      `Please review and update status in the tracker:\n` +
      `${ss.getUrl()}\n\n` +
      `— HOA Tracker (automated notification)`;
    try { MailApp.sendEmail(CONFIG.HSM_EMAIL, subject, body); } catch (err) { Logger.log(err); }
  }
}

// ── Weekly digest (fires every Friday at 8am) ──────────────────
function sendWeeklyDigest() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.TRACKER_SHEET);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1).filter(r => r[CONFIG.COL.STATUS - 1] !== "Complete");

  const overdue   = rows.filter(r => r[CONFIG.COL.STATUS - 1] === "Overdue");
  const awaitingBod = rows.filter(r =>
    String(r[CONFIG.COL.AWAITING_BOD - 1]).trim().toLowerCase() === "yes"
  );
  const inProgress = rows.filter(r => r[CONFIG.COL.STATUS - 1] === "In Progress");
  const notStarted = rows.filter(r => r[CONFIG.COL.STATUS - 1] === "Not Started");

  const formatItem = r => {
    const owner = r[CONFIG.COL.OWNER - 1];
    const due   = r[CONFIG.COL.DUE_DATE - 1] ? ` | Due: ${r[CONFIG.COL.DUE_DATE - 1]}` : "";
    return `  • [${owner}] ${r[CONFIG.COL.TITLE - 1]}${due}`;
  };

  const section = (title, items) =>
    items.length === 0 ? "" :
    `${title} (${items.length})\n${"─".repeat(40)}\n${items.map(formatItem).join("\n")}\n\n`;

  const body =
    `HOA Board ↔ Management Tracker — Weekly Digest\n` +
    `${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEEE, MMMM d, yyyy")}\n` +
    `${"═".repeat(50)}\n\n` +
    section("🔴 OVERDUE", overdue) +
    section("🟡 WAITING ON BOD — DECISION NEEDED", awaitingBod) +
    section("🔵 IN PROGRESS", inProgress) +
    section("⚪ NOT STARTED", notStarted) +
    `Open tracker: ${ss.getUrl()}\n\n` +
    `— HOA Tracker (automated weekly digest)`;

  const subject =
    `[HOA Tracker] Weekly digest — ${overdue.length} overdue, ${awaitingBod.length} waiting on BoD`;

  CONFIG.BOD_EMAILS.forEach(email => {
    try { MailApp.sendEmail(email, subject, body); } catch (err) { Logger.log(err); }
  });
  Logger.log("Weekly digest sent.");
}

// ── Manual: send digest on demand ─────────────────────────────
function sendDigestNow() {
  sendWeeklyDigest();
  SpreadsheetApp.getUi().alert("Digest sent to all BoD email addresses.");
}

// ── Manual: mark an item complete by ID ───────────────────────
function markCompleteById(itemId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.TRACKER_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][CONFIG.COL.ID - 1]) === String(itemId)) {
      sheet.getRange(i + 1, CONFIG.COL.STATUS).setValue("Complete");
      sheet.getRange(i + 1, CONFIG.COL.AWAITING_BOD).setValue("No");
      Logger.log(`Item ${itemId} marked complete.`);
      return;
    }
  }
  Logger.log(`Item ID ${itemId} not found.`);
}

// ── Custom menu ────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("HOA Tracker")
    .addItem("Send digest now", "sendDigestNow")
    .addSeparator()
    .addItem("Run setup (first time only)", "setupSpreadsheet")
    .addItem("Install edit trigger", "createEditTrigger")
    .addItem("Install weekly digest trigger", "createWeeklyTrigger")
    .addToUi();
}
