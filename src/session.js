import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "session.json",
);

/** @type {{ password: string, expiresAt: number, createdAt: number, createdBy: string, createdByUsername: string, checkedIn: string[] } | null} */
let session = null;

export async function loadSession() {
  try {
    const raw = await readFile(dataPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.password && parsed?.expiresAt) {
      session = {
        password: parsed.password,
        expiresAt: parsed.expiresAt,
        createdAt: parsed.createdAt ?? Date.now(),
        createdBy: parsed.createdBy ?? "",
        createdByUsername: parsed.createdByUsername ?? "",
        checkedIn: Array.isArray(parsed.checkedIn) ? parsed.checkedIn : [],
      };
    }
  } catch {
    session = null;
  }
  return session;
}

async function persist() {
  await mkdir(dirname(dataPath), { recursive: true });
  if (!session) {
    await writeFile(dataPath, "null", "utf8");
    return;
  }
  await writeFile(dataPath, JSON.stringify(session, null, 2), "utf8");
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
    checkedIn: [],
  };
  await persist();
  return session;
}

export function hasCheckedIn(userId) {
  return Boolean(session?.checkedIn?.includes(userId));
}

export async function markCheckedIn(userId) {
  if (!session) return;
  if (!session.checkedIn.includes(userId)) {
    session.checkedIn.push(userId);
    await persist();
  }
}

export function formatRemaining(expiresAt) {
  const ms = Math.max(0, expiresAt - Date.now());
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
