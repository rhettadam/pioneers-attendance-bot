import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const sessionPath = join(dataDir, "session.json");
const checkoutsPath = join(dataDir, "checkouts.json");
const earlyLeavesPath = join(dataDir, "early-leaves.json");

/** How long an approved early leave blocks end-of-meeting attendance */
const EARLY_LEAVE_BLOCK_MS = 12 * 60 * 60 * 1000;

/** @type {{ password: string, expiresAt: number, createdAt: number, createdBy: string, createdByUsername: string, attended: string[] } | null} */
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
 *   approvedAt: number,
 *   expiresAt: number,
 * }} ApprovedEarlyLeave
 */

/** @type {PendingCheckout[]} */
let pendingCheckouts = [];

/** @type {ApprovedEarlyLeave[]} */
let approvedEarlyLeaves = [];

export async function loadSession() {
  try {
    const raw = await readFile(sessionPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.password && parsed?.expiresAt) {
      session = {
        password: parsed.password,
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
    pruneExpiredEarlyLeaves();
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

function pruneExpiredEarlyLeaves() {
  const now = Date.now();
  approvedEarlyLeaves = approvedEarlyLeaves.filter((e) => e.expiresAt > now);
}

export function getSession() {
  return session;
}

export function isSessionValid(current = session) {
  return Boolean(current && Date.now() < current.expiresAt);
}

export async function setSession(next) {
  session = {
    ...next,
    attended: [],
  };
  await persistSession();
  return session;
}

export function hasAttended(userId) {
  // Only counts for the *current* active end-of-meeting passphrase
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

export function hasApprovedEarlyLeave(userId) {
  pruneExpiredEarlyLeaves();
  return approvedEarlyLeaves.some((e) => e.userId === userId);
}

export async function markApprovedEarlyLeave(userId, displayName) {
  pruneExpiredEarlyLeaves();
  approvedEarlyLeaves = approvedEarlyLeaves.filter((e) => e.userId !== userId);
  const now = Date.now();
  approvedEarlyLeaves.push({
    userId,
    displayName,
    approvedAt: now,
    expiresAt: now + EARLY_LEAVE_BLOCK_MS,
  });
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

/**
 * Create (or replace) a pending checkout key for a student.
 * @returns {Promise<PendingCheckout>}
 */
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
