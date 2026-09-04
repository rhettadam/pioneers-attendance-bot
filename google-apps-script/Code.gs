/**
 * Paste this into Extensions → Apps Script for your attendance spreadsheet.
 * Then Deploy → Manage deployments → Edit → New version → Deploy.
 *
 * Execute as: Me
 * Who has access: Anyone
 *
 * Set WEBHOOK_SECRET below to the same value as SHEETS_WEBHOOK_SECRET in .env
 *
 * Concurrent appendRow() races drop rows — LockService serializes writes.
 * The bot also retries on "Sheet busy".
 */

const ATTENDANCE_TAB = "Attendance";
const CHECKOUT_TAB = "Checkouts";
const WEBHOOK_SECRET = "change-me-to-a-long-random-string";

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Up to 2 minutes in queue behind other attendance writes
    if (!lock.tryLock(120000)) {
      return json_({ ok: false, error: "Sheet busy — try again" });
    }

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
      SpreadsheetApp.flush();
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
    SpreadsheetApp.flush();

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      // ignore
    }
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
