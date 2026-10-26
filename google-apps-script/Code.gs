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
const MEETINGS_TAB = "Meetings";
const SETTINGS_TAB = "Settings";
const WEBHOOK_SECRET = "change-me-to-a-long-random-string";

function doPost(e) {
  const data = JSON.parse((e.postData && e.postData.contents) || "{}");

  if (!data.secret || data.secret !== WEBHOOK_SECRET) {
    return json_({ ok: false, error: "Unauthorized" });
  }

  const type = data.type || "attendance";

  // Reads must not wait behind 50 check-in writes.
  if (type === "status") {
    try {
      return handleStatus_(data);
    } catch (err) {
      return json_({ ok: false, error: String(err) });
    }
  }

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(20000)) {
      return json_({ ok: false, error: "Sheet busy — try again" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (type === "checkout") {
      return writeDayKeyed_(ss, CHECKOUT_TAB, data, checkoutRow_);
    }
    if (type === "comp") {
      return writeDayKeyed_(ss, COMPS_TAB, data, compRow_);
    }
    if (type === "raised") {
      return writeRaised_(ss, data);
    }

    return writeDayKeyed_(ss, ATTENDANCE_TAB, data, attendanceRow_);
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

function missingTab_(name) {
  return json_({
    ok: false,
    error: 'Missing sheet tab named "' + name + '"',
  });
}

function cacheHas_(key) {
  try {
    return CacheService.getScriptCache().get(key) === "1";
  } catch (_) {
    return false;
  }
}

function cachePut_(key) {
  try {
    CacheService.getScriptCache().put(key, "1", 21600);
  } catch (_) {
    // ignore
  }
}

function cellDay_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  const s = String(value == null ? "" : value).trim();
  if (!s) return "";
  return s.length >= 10 ? s.substring(0, 10) : s;
}

function dayKey_(userId, day) {
  return String(userId) + "\t" + String(day);
}

function raisedKey_(userId, day, amount, note) {
  return (
    String(userId) +
    "\t" +
    String(day) +
    "\t" +
    String(amount) +
    "\t" +
    String(note)
  );
}

function loadDayIndex_(sheet) {
  const seen = {};
  if (!sheet) return seen;
  const last = sheet.getLastRow();
  if (last < 2) return seen;
  const users = sheet.getRange(2, 2, last - 1, 1).getValues();
  const days = sheet.getRange(2, 5, last - 1, 1).getValues();
  for (let i = 0; i < users.length; i++) {
    const id = String(users[i][0] || "");
    const day = cellDay_(days[i][0]);
    if (id && day) seen[dayKey_(id, day)] = true;
  }
  return seen;
}

function loadRaisedIndex_(sheet) {
  const seen = {};
  if (!sheet) return seen;
  const last = sheet.getLastRow();
  if (last < 2) return seen;
  const rows = sheet.getRange(2, 2, last - 1, 6).getValues();
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0] || "");
    const amount = rows[i][3];
    const day = cellDay_(rows[i][4]);
    const note = String(rows[i][5] == null ? "" : rows[i][5]);
    if (id && day) seen[raisedKey_(id, day, amount, note)] = true;
  }
  return seen;
}

function appendRows_(sheet, rows) {
  if (!rows.length) return;
  const start = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

function attendanceRow_(person, data) {
  return [
    field_(person, data, "timestamp") || new Date().toISOString(),
    field_(person, data, "discordUserId"),
    field_(person, data, "discordUsername"),
    field_(person, data, "displayName"),
    field_(person, data, "meetingDay"),
    field_(person, data, "meetingId") || field_(person, data, "passphrase"),
    field_(person, data, "guildId"),
  ];
}

function checkoutRow_(person, data) {
  return [
    field_(person, data, "timestamp") || new Date().toISOString(),
    field_(person, data, "discordUserId"),
    field_(person, data, "discordUsername"),
    field_(person, data, "displayName"),
    field_(person, data, "meetingDay"),
    field_(person, data, "checkoutKey"),
    field_(person, data, "approvedById"),
    field_(person, data, "approvedByUsername"),
    field_(person, data, "guildId"),
  ];
}

function compRow_(person, data) {
  return [
    field_(person, data, "timestamp") || new Date().toISOString(),
    field_(person, data, "discordUserId"),
    field_(person, data, "discordUsername"),
    field_(person, data, "displayName"),
    field_(person, data, "meetingDay"),
    field_(person, data, "reason"),
    field_(person, data, "approvedById"),
    field_(person, data, "approvedByUsername"),
    field_(person, data, "guildId"),
  ];
}

function writeDayKeyed_(ss, tabName, data, toRow) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return missingTab_(tabName);

  const people = studentList_(data);
  if (!people) return json_({ ok: false, error: "No students" });

  const prefix = tabName.toLowerCase() + ":";
  const seen = loadDayIndex_(sheet);
  const rows = [];
  let duplicates = 0;

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    const id = String(field_(person, data, "discordUserId"));
    const day = cellDay_(field_(person, data, "meetingDay"));
    const key = dayKey_(id, day);
    const cacheKey = prefix + key;
    if (!id || !day || seen[key] || cacheHas_(cacheKey)) {
      duplicates += 1;
      continue;
    }
    seen[key] = true;
    cachePut_(cacheKey);
    rows.push(toRow(person, data));
  }

  appendRows_(sheet, rows);
  return json_({
    ok: true,
    added: rows.length,
    duplicates: duplicates,
    duplicate: rows.length === 0 && duplicates > 0,
  });
}

function writeRaised_(ss, data) {
  const sheet = ss.getSheetByName(RAISED_TAB);
  if (!sheet) return missingTab_(RAISED_TAB);

  const people = studentList_(data);
  if (!people) return json_({ ok: false, error: "No students" });

  const seen = loadRaisedIndex_(sheet);
  const rows = [];
  let duplicates = 0;

  for (let i = 0; i < people.length; i++) {
    const person = people[i];
    const id = String(field_(person, data, "discordUserId"));
    const day = cellDay_(field_(person, data, "meetingDay"));
    const amount = field_(person, data, "amount");
    const note = String(field_(person, data, "note"));
    const key = raisedKey_(id, day, amount, note);
    const cacheKey = "raised:" + key;
    if (!id || !day || seen[key] || cacheHas_(cacheKey)) {
      duplicates += 1;
      continue;
    }
    seen[key] = true;
    cachePut_(cacheKey);
    rows.push([
      field_(person, data, "timestamp") || new Date().toISOString(),
      id,
      field_(person, data, "discordUsername"),
      field_(person, data, "displayName"),
      amount,
      day,
      note,
      field_(person, data, "approvedById"),
      field_(person, data, "approvedByUsername"),
      field_(person, data, "guildId"),
    ]);
  }

  appendRows_(sheet, rows);
  return json_({
    ok: true,
    added: rows.length,
    duplicates: duplicates,
    duplicate: rows.length === 0 && duplicates > 0,
  });
}

function uniqueDays_(sheet, userId) {
  const out = [];
  if (!sheet) return out;
  const last = sheet.getLastRow();
  if (last < 2) return out;
  const users = sheet.getRange(2, 2, last - 1, 1).getValues();
  const days = sheet.getRange(2, 5, last - 1, 1).getValues();
  const seen = {};
  for (let i = 0; i < users.length; i++) {
    if (String(users[i][0] || "") !== userId) continue;
    const day = cellDay_(days[i][0]);
    if (!day || seen[day]) continue;
    seen[day] = true;
    out.push(day);
  }
  return out;
}

function sumRaised_(sheet, userId) {
  if (!sheet) return 0;
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const users = sheet.getRange(2, 2, last - 1, 1).getValues();
  const amounts = sheet.getRange(2, 5, last - 1, 1).getValues();
  let total = 0;
  for (let i = 0; i < users.length; i++) {
    if (String(users[i][0] || "") !== userId) continue;
    const n = Number(amounts[i][0]);
    if (isFinite(n)) total += n;
  }
  return total;
}

function loadMeetings_(sheet) {
  const out = { weight: {}, capacity: 0 };
  if (!sheet) return out;
  const last = sheet.getLastRow();
  if (last < 2) return out;
  const values = sheet.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    const day = cellDay_(values[i][0]);
    const w = Number(values[i][1]);
    if (!day || !isFinite(w)) continue;
    out.weight[day] = w;
    out.capacity += w;
  }
  return out;
}

function parseGoalPercent_(raw) {
  if (raw === "" || raw == null) return null;
  if (typeof raw === "string" && raw.indexOf("%") !== -1) {
    const n = Number(String(raw).replace("%", "").trim());
    return isFinite(n) ? n / 100 : null;
  }
  const n = Number(raw);
  if (!isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function loadSettings_(sheet) {
  const out = { attendanceGoal: null, raisedGoal: null };
  if (!sheet) return out;
  const last = sheet.getLastRow();
  if (last < 1) return out;
  const values = sheet.getRange(1, 1, last, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    const key = String(values[i][0] || "")
      .trim()
      .toLowerCase();
    if (key === "attendance goal") {
      out.attendanceGoal = parseGoalPercent_(values[i][1]);
    } else if (key === "raised goal") {
      const n = Number(values[i][1]);
      out.raisedGoal = isFinite(n) ? n : null;
    }
  }
  return out;
}

function handleStatus_(data) {
  const id = String(data.discordUserId || "");
  if (!id) return json_({ ok: false, error: "Missing discordUserId" });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const attended = uniqueDays_(ss.getSheetByName(ATTENDANCE_TAB), id);
  const checkouts = uniqueDays_(ss.getSheetByName(CHECKOUT_TAB), id);
  const comps = uniqueDays_(ss.getSheetByName(COMPS_TAB), id);

  const creditedSeen = {};
  const credited = [];
  const all = attended.concat(checkouts, comps);
  for (let i = 0; i < all.length; i++) {
    if (!all[i] || creditedSeen[all[i]]) continue;
    creditedSeen[all[i]] = true;
    credited.push(all[i]);
  }

  const meetings = loadMeetings_(ss.getSheetByName(MEETINGS_TAB));
  let weighted = 0;
  for (let i = 0; i < credited.length; i++) {
    const w = meetings.weight[credited[i]];
    if (w) weighted += w;
  }

  const goals = loadSettings_(ss.getSheetByName(SETTINGS_TAB));
  const capacity = meetings.capacity;
  const percent = capacity > 0 ? weighted / capacity : 0;

  return json_({
    ok: true,
    attendedDays: attended.length,
    checkoutDays: checkouts.length,
    compDays: comps.length,
    creditedDays: credited.length,
    weightedCredit: weighted,
    capacityWeighted: capacity,
    percentWeighted: percent,
    raised: sumRaised_(ss.getSheetByName(RAISED_TAB), id),
    attendanceGoal: goals.attendanceGoal,
    raisedGoal: goals.raisedGoal,
  });
}
