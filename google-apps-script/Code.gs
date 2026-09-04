/**
 * Paste this into Extensions → Apps Script for your attendance spreadsheet.
 * Then Deploy → New deployment → Web app (or Manage deployments → New version).
 *
 * Execute as: Me
 * Who has access: Anyone
 *
 * Set WEBHOOK_SECRET below to the same value as SHEETS_WEBHOOK_SECRET in .env
 */

const ATTENDANCE_TAB = "Attendance";
const CHECKOUT_TAB = "Checkouts";
const WEBHOOK_SECRET = "change-me-to-a-long-random-string";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || "{}");

    if (!data.secret || data.secret !== WEBHOOK_SECRET) {
      return json_({ ok: false, error: "Unauthorized" });
    }

    const type = data.type || "attendance";
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (type === "checkout") {
      const sheet = ss.getSheetByName(CHECKOUT_TAB);
      if (!sheet) {
        return json_({
          ok: false,
          error: 'Missing sheet tab named "' + CHECKOUT_TAB + '"',
        });
      }
      sheet.appendRow([
        data.timestamp || new Date().toISOString(),
        data.discordUserId || "",
        data.discordUsername || "",
        data.displayName || "",
        data.checkoutKey || "",
        data.approvedById || "",
        data.approvedByUsername || "",
        data.guildId || "",
      ]);
      return json_({ ok: true });
    }

    const sheet = ss.getSheetByName(ATTENDANCE_TAB);
    if (!sheet) {
      return json_({
        ok: false,
        error: 'Missing sheet tab named "' + ATTENDANCE_TAB + '"',
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
