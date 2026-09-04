/**
 * Paste this into Extensions → Apps Script for your attendance spreadsheet.
 * Then Deploy → New deployment → Web app.
 *
 * Execute as: Me
 * Who has access: Anyone
 *
 * Set WEBHOOK_SECRET below to the same value as SHEETS_WEBHOOK_SECRET in .env
 */

const SHEET_TAB_NAME = "Attendance";
const WEBHOOK_SECRET = "change-me-to-a-long-random-string";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");

    if (!data.secret || data.secret !== WEBHOOK_SECRET) {
      return json_({ ok: false, error: "Unauthorized" });
    }

    const sheet =
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TAB_NAME);
    if (!sheet) {
      return json_({
        ok: false,
        error: 'Missing sheet tab named "' + SHEET_TAB_NAME + '"',
      });
    }

    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.discordUserId || "",
      data.discordUsername || "",
      data.displayName || "",
      data.passphrase || "",
      data.guildId || "",
    ]);

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({
    ok: true,
    message: "Pioneers attendance webhook is live. Use POST from the Discord bot.",
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
