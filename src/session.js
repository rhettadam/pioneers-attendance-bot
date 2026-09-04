import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const sessionPath = join(dataDir, "session.json");
const checkoutsPath = join(dataDir, "checkouts.json");
const earlyLeavesPath = join(dataDir, "early-leaves.json");

/** Team local calendar day for early-leave ↔ end-attendance binding */
const TEAM_TIMEZONE = process.env.TEAM_TIMEZONE || "America/Chicago";

/** @type {{ password: string, meetingId: string, meetingDay: string, expiresAt: number, createdAt: number, createdBy: string, createdByUsername: string, attended: string[] } | null} */
let session = null;

/**
 * @typedef {{
 *   key: string,
 *   userId: string,
 *   username: string,
 *   displayName: string,
 *   guildId: string,
 *   createdAt: number,
 *   expiresAt: number,
 * }} PendingCheckout
 */

/**
 * @typedef {{
 *   userId: string,
 *   displayName: string,
 *   meetingDay: string,
 *   approvedAt: number,
 * }} ApprovedEarlyLeave
 */

/** @type {PendingCheckout[]} */
let pendingCheckouts = [];

/** @type {ApprovedEarlyLeave[]} */
let approvedEarlyLeaves = [];

export function meetingDayFor(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function loadSession() {
  try {
    const raw = await readFile(sessionPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.password && parsed?.expiresAt) {
      session = {
        password: parsed.password,
        meetingId: parsed.meetingId || "",
        meetingDay:
          parsed.meetingDay ||
          meetingDayFor(new Date(parsed.createdAt || Date.now())),
        expiresAt: parsed.expiresAt,
        createdAt: parsed.createdAt ?? Date.now(),
        createdBy: parsed.createdBy ?? "",
        createdByUsername: parsed.createdByUsername ?? "",
        attended: Array.isArray(parsed.attended)
          ? parsed.attended
          : Array.isArray(parsed.checkedIn)
            ? parsed.checkedIn
            : [],
      };
    }
  } catch {
    session = null;
  }

  try {
    const raw = await readFile(checkoutsPath, "utf8");
    const parsed = JSON.parse(raw);
    pendingCheckouts = Array.isArray(parsed) ? parsed : [];
    pruneExpiredCheckouts();
  } catch {
    pendingCheckouts = [];
  }

  try {
    const raw = await readFile(earlyLeavesPath, "utf8");
    const parsed = JSON.parse(raw);
    approvedEarlyLeaves = Array.isArray(parsed) ? parsed : [];
    pruneOldEarlyLeaves();
  } catch {
    approvedEarlyLeaves = [];
  }

  return session;
}

async function persistSession() {
  await mkdir(dataDir, { recursive: true });
  if (!session) {
    await writeFile(sessionPath, "null", "utf8");
    return;
  }
  await writeFile(sessionPath, JSON.stringify(session, null, 2), "utf8");
}

async function persistCheckouts() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(checkoutsPath, JSON.stringify(pendingCheckouts, null, 2), "utf8");
}

async function persistEarlyLeaves() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    earlyLeavesPath,
    JSON.stringify(approvedEarlyLeaves, null, 2),
    "utf8",
  );
}

function pruneExpiredCheckouts() {
  const now = Date.now();
  pendingCheckouts = pendingCheckouts.filter((c) => c.expiresAt > now);
}

/** Drop early-leave records older than yesterday (team timezone). */
function pruneOldEarlyLeaves() {
  const today = meetingDayFor();
  const yesterday = meetingDayFor(new Date(Date.now() - 36 * 60 * 60 * 1000));
  approvedEarlyLeaves = approvedEarlyLeaves.filter((e) => {
    const day = e.meetingDay || meetingDayFor(new Date(e.approvedAt || 0));
    return day === today || day === yesterday;
  });
}

export function getSession() {
  return session;
}

export function isSessionValid(current = session) {
  return Boolean(current && Date.now() < current.expiresAt);
}

export async function setSession(next) {
  const meetingDay = next.meetingDay || meetingDayFor();
  session = {
    ...next,
    meetingId: next.meetingId || "",
    meetingDay,
    attended: [],
  };
  pruneOldEarlyLeaves();
  await persistEarlyLeaves();
  await persistSession();
  return session;
}

export function hasAttended(userId) {
  if (!isSessionValid()) return false;
  return Boolean(session?.attended?.includes(userId));
}

export async function markAttended(userId) {
  if (!session) return;
  if (!session.attended.includes(userId)) {
    session.attended.push(userId);
    await persistSession();
  }
}

/**
 * Early leave blocks end-of-meeting attendance for the same team-local calendar day.
 */
export function hasApprovedEarlyLeave(userId) {
  pruneOldEarlyLeaves();
  const day = session?.meetingDay || meetingDayFor();
  return approvedEarlyLeaves.some((e) => {
    const leaveDay =
      e.meetingDay || meetingDayFor(new Date(e.approvedAt || 0));
    return e.userId === userId && leaveDay === day;
  });
}

export async function markApprovedEarlyLeave(userId, displayName) {
  pruneOldEarlyLeaves();
  const meetingDay = meetingDayFor();
  approvedEarlyLeaves = approvedEarlyLeaves.filter((e) => e.userId !== userId);
  approvedEarlyLeaves.push({
    userId,
    displayName,
    meetingDay,
    approvedAt: Date.now(),
  });
  await persistEarlyLeaves();
}

export async function clearEarlyLeave(userId) {
  approvedEarlyLeaves = approvedEarlyLeaves.filter((e) => e.userId !== userId);
  await persistEarlyLeaves();
}

export function formatRemaining(expiresAt) {
  const ms = Math.max(0, expiresAt - Date.now());
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function makeCheckoutKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let key = "";
  for (let i = 0; i < 6; i++) {
    key += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return key;
}

export async function createPendingCheckout({
  userId,
  username,
  displayName,
  guildId,
  ttlMinutes,
}) {
  pruneExpiredCheckouts();
  pendingCheckouts = pendingCheckouts.filter((c) => c.userId !== userId);

  const now = Date.now();
  /** @type {PendingCheckout} */
  const pending = {
    key: makeCheckoutKey(),
    userId,
    username,
    displayName,
    guildId: guildId || "",
    createdAt: now,
    expiresAt: now + ttlMinutes * 60_000,
  };
  pendingCheckouts.push(pending);
  await persistCheckouts();
  return pending;
}

export function findPendingCheckout(key) {
  pruneExpiredCheckouts();
  const normalized = key.trim().toUpperCase();
  return pendingCheckouts.find((c) => c.key === normalized) || null;
}

export async function consumePendingCheckout(key) {
  pruneExpiredCheckouts();
  const normalized = key.trim().toUpperCase();
  const index = pendingCheckouts.findIndex((c) => c.key === normalized);
  if (index === -1) return null;
  const [pending] = pendingCheckouts.splice(index, 1);
  await persistCheckouts();
  return pending;
}

export function getPendingCheckoutForUser(userId) {
  pruneExpiredCheckouts();
  return pendingCheckouts.find((c) => c.userId === userId) || null;
}
