/**
 * Paste this into Extensions → Apps Script for your attendance spreadsheet.
 * Then Deploy → Manage deployments → Edit → New version → Deploy.
 *
 * Execute as: Me
 * Who has access: Anyone
 *
 * Set WEBHOOK_SECRET below to the same value as SHEETS_WEBHOOK_SECRET in .env
 */

const ATTENDANCE_TAB = "Attendance";
const CHECKOUT_TAB = "Checkouts";
const COMPS_TAB = "Comps";
const RAISED_TAB = "Raised";
const WEBHOOK_SECRET = "change-me-to-a-long-random-string";

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
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
        data.meetingDay || "",
        data.checkoutKey || "",
        data.approvedById || "",
        data.approvedByUsername || "",
        data.guildId || "",
      ]);
      SpreadsheetApp.flush();
      return json_({ ok: true });
    }

    if (type === "comp") {
      const sheet = ss.getSheetByName(COMPS_TAB);
      if (!sheet) {
        return json_({
          ok: false,
          error: 'Missing sheet tab named "' + COMPS_TAB + '"',
        });
      }
      const people = studentList_(data);
      if (!people) {
        return json_({ ok: false, error: "No students" });
      }
      for (let i = 0; i < people.length; i++) {
        const person = people[i];
        sheet.appendRow([
          field_(person, data, "timestamp") || new Date().toISOString(),
          field_(person, data, "discordUserId"),
          field_(person, data, "discordUsername"),
          field_(person, data, "displayName"),
          field_(person, data, "meetingDay"),
          field_(person, data, "reason"),
          field_(person, data, "approvedById"),
          field_(person, data, "approvedByUsername"),
          field_(person, data, "guildId"),
        ]);
      }
      SpreadsheetApp.flush();
      return json_({ ok: true });
    }

    if (type === "raised") {
      const sheet = ss.getSheetByName(RAISED_TAB);
      if (!sheet) {
        return json_({
          ok: false,
          error: 'Missing sheet tab named "' + RAISED_TAB + '"',
        });
      }
      const people = studentList_(data);
      if (!people) {
        return json_({ ok: false, error: "No students" });
      }
      for (let i = 0; i < people.length; i++) {
        const person = people[i];
        sheet.appendRow([
          field_(person, data, "timestamp") || new Date().toISOString(),
          field_(person, data, "discordUserId"),
          field_(person, data, "discordUsername"),
          field_(person, data, "displayName"),
          field_(person, data, "amount"),
          field_(person, data, "meetingDay"),
          field_(person, data, "note"),
          field_(person, data, "approvedById"),
          field_(person, data, "approvedByUsername"),
          field_(person, data, "guildId"),
        ]);
      }
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
      data.meetingDay || "",
      data.meetingId || data.passphrase || "",
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

/** Batch `students` array, or a single flat row. Empty array → null. */
function studentList_(data) {
  if (Array.isArray(data.students)) {
    return data.students.length ? data.students : null;
  }
  return [data];
}

function field_(person, data, name) {
  if (person && person[name] != null && person[name] !== "") {
    return person[name];
  }
  if (data && data[name] != null && data[name] !== "") {
    return data[name];
  }
  return "";
}
