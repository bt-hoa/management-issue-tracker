// ============================================================
// HOA Board ↔ Management Tracker — Google Apps Script
// ============================================================
// SETUP INSTRUCTIONS:
//  1. Import HOA_Tracker_Data.csv into Google Sheets as sheet "Tracker"
//  2. Extensions → Apps Script → paste this file
//  3. Run setupSpreadsheet() once (HOA Tracker menu → Run setup)
//  4. Run createWeeklyTrigger() once
//  5. Run createEditTrigger() once
//  6. Update CONFIG below with real email addresses
// ============================================================

const CONFIG = {
  TRACKER_SHEET:   "Tracker",
  CHANGELOG_SHEET: "Change Log",

  BOD_EMAILS: [
    "board.member.1@example.com",
    "board.member.2@example.com",
    "board.member.3@example.com",
  ],
  HSM_EMAIL: "hsm.contact@example.com",

  // Column indices (1-based)
  COL: {
    ID:             1,
    SECTION:        2,
    TITLE:          3,
    DESCRIPTION:    4,
    RESPONSIBILITY: 5,   // formerly Owner
    PRIMARY_CONTACT:6,   // new
    STATUS:         7,
    DUE_DATE:       8,
    AWAITING_BOD:   9,
    AWAITING_TEXT:  10,
    BOD_RESPONSE:   11,
    BOD_RESP_DATE:  12,
    NOTES:          13,
    LAST_UPDATED:   14,
    UPDATED_BY:     15,
  },

  VALID_STATUSES:       ["Not Started", "In Progress", "Overdue", "Complete"],
  VALID_RESPONSIBILITY: ["HSM", "BoD", "Joint"],
};

// ── Column letter helper ───────────────────────────────────────
function colLetter(n) {
  let s = "";
  while (n > 0) { const r = (n-1)%26; s = String.fromCharCode(65+r)+s; n = Math.floor((n-1)/26); }
  return s;
}

// ── One-time setup ─────────────────────────────────────────────
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let tracker = ss.getSheetByName(CONFIG.TRACKER_SHEET);
  if (!tracker) {
    tracker = ss.insertSheet(CONFIG.TRACKER_SHEET);
    SpreadsheetApp.getUi().alert('Created "Tracker" sheet. Import HOA_Tracker_Data.csv into it, then re-run setupSpreadsheet().');
    return;
  }

  // Change Log tab
  let changelog = ss.getSheetByName(CONFIG.CHANGELOG_SHEET);
  if (!changelog) changelog = ss.insertSheet(CONFIG.CHANGELOG_SHEET);
  changelog.clearContents();
  const clHeaders = ["Timestamp","Item ID","Section","Title","Field Changed","Old Value","New Value","Editor Email"];
  changelog.appendRow(clHeaders);
  changelog.setFrozenRows(1);
  changelog.getRange(1,1,1,clHeaders.length).setBackground("#3c3489").setFontColor("white").setFontWeight("bold");
  [160,50,120,260,160,200,200,200].forEach((w,i) => changelog.setColumnWidth(i+1, w));

  // Header formatting
  tracker.setFrozenRows(1);
  const lastCol = Object.keys(CONFIG.COL).length;
  tracker.getRange(1,1,1,lastCol).setBackground("#3c3489").setFontColor("white").setFontWeight("bold");

  // Column widths
  const widths = [40,120,260,300,100,160,100,130,100,260,260,110,260,110,160];
  widths.forEach((w,i) => tracker.setColumnWidth(i+1, w));

  // Dropdowns
  const lastRow = Math.max(tracker.getLastRow(), 2);
  tracker.getRange(2, CONFIG.COL.STATUS, lastRow-1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.VALID_STATUSES, true).build());
  tracker.getRange(2, CONFIG.COL.RESPONSIBILITY, lastRow-1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.VALID_RESPONSIBILITY, true).build());
  tracker.getRange(2, CONFIG.COL.AWAITING_BOD, lastRow-1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Yes","No"], true).build());

  // Conditional formatting
  const statusCol = colLetter(CONFIG.COL.STATUS);
  const awaitCol  = colLetter(CONFIG.COL.AWAITING_BOD);
  const range = tracker.getRange(`A2:${colLetter(lastCol)}${lastRow}`);
  tracker.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$${statusCol}2="Overdue"`).setBackground("#fce8e8").setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$${statusCol}2="Complete"`).setBackground("#e8f5e9").setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$${awaitCol}2="Yes"`).setBackground("#fff3e0").setRanges([range]).build(),
  ]);

  // Audit column protection (warning only)
  tracker.getRange(1, CONFIG.COL.LAST_UPDATED, lastRow, 2).protect()
    .setDescription("Audit columns — written by script only").setWarningOnly(true);
  tracker.getRange(2, CONFIG.COL.BOD_RESPONSE, lastRow-1, 2).protect()
    .setDescription("BoD direction — BoD editors only").setWarningOnly(true);

  SpreadsheetApp.getUi().alert(
    "Setup complete!\n\n" +
    "Next steps:\n" +
    "1. HOA Tracker menu → Install edit trigger\n" +
    "2. HOA Tracker menu → Install weekly digest trigger\n" +
    "3. Data → Protect Sheets & Ranges → restrict BoD Direction columns (K–L) to BoD editors only\n" +
    "4. Update CONFIG.BOD_EMAILS and CONFIG.HSM_EMAIL with real addresses\n\n" +
    "Sorting tip: Data → Create a filter, then sort column G (Status) or F (Primary Contact) as needed."
  );
}

// ── Trigger installers ─────────────────────────────────────────
function createEditTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction()==="onTrackerEdit")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onTrackerEdit").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  Logger.log("onEdit trigger created.");
}

function createWeeklyTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction()==="sendWeeklyDigest")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sendWeeklyDigest").timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(8).create();
  Logger.log("Weekly Friday 8am digest trigger created.");
}

// ── onEdit handler ─────────────────────────────────────────────
function onTrackerEdit(e) {
  if (!e) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.TRACKER_SHEET) return;
  const row = e.range.getRow(); const col = e.range.getColumn();
  if (row < 2) return;

  const ss = sheet.getParent();
  const rowData = sheet.getRange(row, 1, 1, Object.keys(CONFIG.COL).length).getValues()[0];
  const itemId = rowData[CONFIG.COL.ID-1], section = rowData[CONFIG.COL.SECTION-1], title = rowData[CONFIG.COL.TITLE-1];
  const editor = e.user ? e.user.getEmail() : "unknown";
  const now = new Date();
  const changedField = (Object.entries(CONFIG.COL).find(([,v]) => v===col) || ["Unknown"])[0];

  // Change log
  const changelog = ss.getSheetByName(CONFIG.CHANGELOG_SHEET);
  if (changelog) changelog.appendRow([now, itemId, section, title, changedField, e.oldValue||"", e.value||"", editor]);

  // Audit stamp
  sheet.getRange(row, CONFIG.COL.LAST_UPDATED).setValue(Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd"));
  sheet.getRange(row, CONFIG.COL.UPDATED_BY).setValue(editor);

  // Alert BoD when HSM flags awaiting
  if (col === CONFIG.COL.AWAITING_BOD && String(e.value).trim().toLowerCase() === "yes") {
    const awaitingText = rowData[CONFIG.COL.AWAITING_TEXT-1] || "(no detail provided)";
    const subject = `[HOA Tracker] Action needed: "${title}"`;
    const body = `HSM has flagged an item as waiting for Board direction.\n\nItem: ${title}\nSection: ${section}\nWhat is needed:\n${awaitingText}\n\nOpen tracker: ${ss.getUrl()}\n\n— HOA Tracker`;
    CONFIG.BOD_EMAILS.forEach(email => { try { MailApp.sendEmail(email, subject, body); } catch(err) { Logger.log(err); }});
  }

  // Notify HSM when BoD records response
  if (col === CONFIG.COL.BOD_RESPONSE && e.value && e.value.trim() !== "") {
    const subject = `[HOA Tracker] BoD direction recorded: "${title}"`;
    const body = `The Board has recorded a direction for the following item.\n\nItem: ${title}\nSection: ${section}\nBoD Direction:\n${e.value.trim()}\n\nOpen tracker: ${ss.getUrl()}\n\n— HOA Tracker`;
    try { MailApp.sendEmail(CONFIG.HSM_EMAIL, subject, body); } catch(err) { Logger.log(err); }
  }
}

// ── Weekly digest ──────────────────────────────────────────────
function sendWeeklyDigest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.TRACKER_SHEET);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues().slice(1)
    .filter(r => r[CONFIG.COL.STATUS-1] !== "Complete");

  const overdue     = data.filter(r => r[CONFIG.COL.STATUS-1] === "Overdue");
  const awaitingBod = data.filter(r => String(r[CONFIG.COL.AWAITING_BOD-1]).trim().toLowerCase() === "yes");
  const inProgress  = data.filter(r => r[CONFIG.COL.STATUS-1] === "In Progress");
  const notStarted  = data.filter(r => r[CONFIG.COL.STATUS-1] === "Not Started");

  const fmt = r => {
    const contact = r[CONFIG.COL.PRIMARY_CONTACT-1] ? ` (${r[CONFIG.COL.PRIMARY_CONTACT-1]})` : "";
    const due = r[CONFIG.COL.DUE_DATE-1] ? ` | Due: ${r[CONFIG.COL.DUE_DATE-1]}` : "";
    return `  • [${r[CONFIG.COL.RESPONSIBILITY-1]}]${contact} ${r[CONFIG.COL.TITLE-1]}${due}`;
  };
  const sec = (title, items) => items.length === 0 ? "" :
    `${title} (${items.length})\n${"─".repeat(40)}\n${items.map(fmt).join("\n")}\n\n`;

  const body =
    `HOA Board ↔ Management Tracker — Weekly Digest\n` +
    `${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEEE, MMMM d, yyyy")}\n` +
    `${"═".repeat(50)}\n\n` +
    sec("🔴 OVERDUE", overdue) +
    sec("🟡 WAITING ON BOD", awaitingBod) +
    sec("🔵 IN PROGRESS", inProgress) +
    sec("⚪ NOT STARTED", notStarted) +
    `Open tracker: ${ss.getUrl()}\n\n— HOA Tracker (weekly digest)`;

  const subject = `[HOA Tracker] Weekly digest — ${overdue.length} overdue, ${awaitingBod.length} waiting on BoD`;
  CONFIG.BOD_EMAILS.forEach(email => { try { MailApp.sendEmail(email, subject, body); } catch(err) { Logger.log(err); }});
}

// ── Dialog editor — edit any item by ID ───────────────────────
// Shows a form dialog for updating a single item without scrolling.
// Usage: HOA Tracker menu → Edit item by ID
function showEditDialog() {
  const ui = SpreadsheetApp.getUi();
  const idResult = ui.prompt("Edit Item", "Enter the item ID to edit:", ui.ButtonSet.OK_CANCEL);
  if (idResult.getSelectedButton() !== ui.Button.OK) return;
  const targetId = idResult.getResponseText().trim();

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TRACKER_SHEET);
  const data = sheet.getDataRange().getValues();
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][CONFIG.COL.ID-1]) === targetId) { targetRow = i+1; break; }
  }
  if (targetRow === -1) { ui.alert(`Item ID ${targetId} not found.`); return; }

  const row = sheet.getRange(targetRow, 1, 1, Object.keys(CONFIG.COL).length).getValues()[0];
  const C = CONFIG.COL;

  const escHtml = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  const statusOptions = CONFIG.VALID_STATUSES.map(s =>
    `<option value="${s}"${row[C.STATUS-1]===s?" selected":""}>${s}</option>`).join("");
  const respOptions = CONFIG.VALID_RESPONSIBILITY.map(s =>
    `<option value="${s}"${row[C.RESPONSIBILITY-1]===s?" selected":""}>${s}</option>`).join("");
  const awaitOptions = ["Yes","No"].map(s =>
    `<option value="${s}"${String(row[C.AWAITING_BOD-1])===s?" selected":""}>${s}</option>`).join("");

  const html = HtmlService.createHtmlOutput(`
<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; font-family: Arial, sans-serif; font-size: 13px; }
  body { margin: 0; padding: 14px; background: #f8f8f8; }
  h3 { margin: 0 0 12px; font-size: 15px; color: #3c3489; }
  .item-id { color: #888; font-size: 12px; margin-bottom: 12px; }
  .title-display { font-weight: bold; margin-bottom: 14px; color: #222; line-height: 1.4; }
  label { display: block; font-size: 11px; font-weight: bold; color: #555; text-transform: uppercase;
          letter-spacing: 0.04em; margin-bottom: 3px; margin-top: 10px; }
  select, input, textarea { width: 100%; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px;
    font-size: 13px; background: white; }
  textarea { resize: vertical; min-height: 64px; line-height: 1.5; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .awaiting-box { background: #fff3e0; border-left: 3px solid #e6a817; padding: 8px 10px;
    border-radius: 0 4px 4px 0; margin-top: 8px; display: none; }
  .awaiting-box.show { display: block; }
  .btn-row { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
  button { padding: 7px 18px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; }
  .btn-save { background: #3c3489; color: white; }
  .btn-cancel { background: #e0e0e0; color: #333; }
  .saved-msg { color: green; font-size: 12px; display: none; margin-top: 6px; text-align: right; }
</style>
</head>
<body>
<h3>Edit Item #${escHtml(targetId)}</h3>
<div class="title-display">${escHtml(row[C.TITLE-1])}</div>

<div class="row2">
  <div>
    <label>Status</label>
    <select id="status">${statusOptions}</select>
  </div>
  <div>
    <label>Responsibility</label>
    <select id="responsibility">${respOptions}</select>
  </div>
</div>

<div class="row2">
  <div>
    <label>Primary Contact</label>
    <input type="text" id="primaryContact" value="${escHtml(row[C.PRIMARY_CONTACT-1])}">
  </div>
  <div>
    <label>Due / Target Date</label>
    <input type="text" id="dueDate" value="${escHtml(row[C.DUE_DATE-1])}">
  </div>
</div>

<label>Awaiting BoD?</label>
<select id="awaitingBod" onchange="toggleAwaiting(this.value)">${awaitOptions}</select>

<div class="awaiting-box ${String(row[C.AWAITING_BOD-1])==='Yes'?'show':''}" id="awaitingBox">
  <label>What HSM is waiting on BoD for</label>
  <textarea id="awaitingText">${escHtml(row[C.AWAITING_TEXT-1])}</textarea>
</div>

<label>BoD Direction / Response</label>
<textarea id="bodResponse">${escHtml(row[C.BOD_RESPONSE-1])}</textarea>

<label>Notes / History</label>
<textarea id="notes">${escHtml(row[C.NOTES-1])}</textarea>

<div class="btn-row">
  <button class="btn-cancel" onclick="google.script.host.close()">Cancel</button>
  <button class="btn-save" onclick="saveItem()">Save</button>
</div>
<div class="saved-msg" id="savedMsg">✓ Saved successfully</div>

<script>
function toggleAwaiting(val) {
  document.getElementById('awaitingBox').className = 'awaiting-box' + (val==='Yes'?' show':'');
}
function saveItem() {
  const data = {
    status:          document.getElementById('status').value,
    responsibility:  document.getElementById('responsibility').value,
    primaryContact:  document.getElementById('primaryContact').value,
    dueDate:         document.getElementById('dueDate').value,
    awaitingBod:     document.getElementById('awaitingBod').value,
    awaitingText:    document.getElementById('awaitingText').value,
    bodResponse:     document.getElementById('bodResponse').value,
    notes:           document.getElementById('notes').value,
  };
  google.script.run
    .withSuccessHandler(() => {
      document.getElementById('savedMsg').style.display = 'block';
      setTimeout(() => google.script.host.close(), 1200);
    })
    .withFailureHandler(err => alert('Error saving: ' + err.message))
    .saveItemFromDialog(${targetId}, data);
}
<\/script>
</body>
</html>
`).setWidth(520).setHeight(640).setTitle(`Edit Item #${targetId}`);

  SpreadsheetApp.getUi().showModalDialog(html, `Edit Item #${targetId}`);
}

// ── Called from dialog via google.script.run ──────────────────
function saveItemFromDialog(itemId, data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TRACKER_SHEET);
  const allData = sheet.getDataRange().getValues();
  const C = CONFIG.COL;
  const editor = Session.getActiveUser().getEmail();
  const now = new Date();
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");

  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][C.ID-1]) === String(itemId)) {
      const rowNum = i + 1;
      const oldRow = allData[i];

      // Write updated fields
      const updates = [
        [rowNum, C.STATUS,          data.status],
        [rowNum, C.RESPONSIBILITY,  data.responsibility],
        [rowNum, C.PRIMARY_CONTACT, data.primaryContact],
        [rowNum, C.DUE_DATE,        data.dueDate],
        [rowNum, C.AWAITING_BOD,    data.awaitingBod],
        [rowNum, C.AWAITING_TEXT,   data.awaitingText],
        [rowNum, C.BOD_RESPONSE,    data.bodResponse],
        [rowNum, C.NOTES,           data.notes],
        [rowNum, C.LAST_UPDATED,    dateStr],
        [rowNum, C.UPDATED_BY,      editor],
      ];
      updates.forEach(([r,c,v]) => sheet.getRange(r,c).setValue(v));

      // Log changes
      const changelog = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CHANGELOG_SHEET);
      const fieldMap = {
        status: C.STATUS, responsibility: C.RESPONSIBILITY, primaryContact: C.PRIMARY_CONTACT,
        dueDate: C.DUE_DATE, awaitingBod: C.AWAITING_BOD, awaitingText: C.AWAITING_TEXT,
        bodResponse: C.BOD_RESPONSE, notes: C.NOTES,
      };
      const title = oldRow[C.TITLE-1], section = oldRow[C.SECTION-1];
      Object.entries(fieldMap).forEach(([field, col]) => {
        const oldVal = String(oldRow[col-1]||"");
        const newVal = String(data[field]||"");
        if (oldVal !== newVal && changelog) {
          changelog.appendRow([now, itemId, section, title, field, oldVal, newVal, editor]);
        }
      });

      // Alert BoD if newly flagged awaiting
      if (data.awaitingBod === "Yes" && String(oldRow[C.AWAITING_BOD-1]) !== "Yes") {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const subject = `[HOA Tracker] Action needed: "${title}"`;
        const body = `HSM has flagged item #${itemId} as waiting for Board direction.\n\nItem: ${title}\nSection: ${section}\nWhat is needed:\n${data.awaitingText||"(no detail provided)"}\n\nOpen tracker: ${ss.getUrl()}\n\n— HOA Tracker`;
        CONFIG.BOD_EMAILS.forEach(email => { try { MailApp.sendEmail(email, subject, body); } catch(e) { Logger.log(e); }});
      }

      // Notify HSM if BoD response added
      if (data.bodResponse && data.bodResponse.trim() !== "" && String(oldRow[C.BOD_RESPONSE-1]).trim() === "") {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const subject = `[HOA Tracker] BoD direction recorded: "${title}"`;
        const body = `The Board has recorded a direction for item #${itemId}.\n\nItem: ${title}\nSection: ${section}\nBoD Direction:\n${data.bodResponse.trim()}\n\nOpen tracker: ${ss.getUrl()}\n\n— HOA Tracker`;
        try { MailApp.sendEmail(CONFIG.HSM_EMAIL, subject, body); } catch(e) { Logger.log(e); }
      }
      return;
    }
  }
  throw new Error(`Item ID ${itemId} not found.`);
}

// ── Utility functions ──────────────────────────────────────────
function sendDigestNow() {
  sendWeeklyDigest();
  SpreadsheetApp.getUi().alert("Digest sent to all BoD email addresses.");
}

function markCompleteById(itemId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TRACKER_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][CONFIG.COL.ID-1]) === String(itemId)) {
      sheet.getRange(i+1, CONFIG.COL.STATUS).setValue("Complete");
      sheet.getRange(i+1, CONFIG.COL.AWAITING_BOD).setValue("No");
      return;
    }
  }
}

// ── Custom menu ────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("HOA Tracker")
    .addItem("✏️  Edit item by ID…", "showEditDialog")
    .addSeparator()
    .addItem("📧  Send digest now", "sendDigestNow")
    .addSeparator()
    .addItem("⚙️  Run setup (first time only)", "setupSpreadsheet")
    .addItem("⚙️  Install edit trigger", "createEditTrigger")
    .addItem("⚙️  Install weekly digest trigger", "createWeeklyTrigger")
    .addToUi();
}
