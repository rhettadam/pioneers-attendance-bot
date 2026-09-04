/**
 * Stress-test the Google Apps Script webhook (the slow/fragile part under load).
 *
 * This does NOT go through Discord. It simulates N students marking attendance
 * by POSTing directly to SHEETS_WEBHOOK_URL — the same call the bot makes.
 *
 * Usage (from project root, with .env filled in):
 *   node scripts/stress-test.js
 *   node scripts/stress-test.js 10
 *   node scripts/stress-test.js 10 attendance
 *   node scripts/stress-test.js 10 attendance 8     # concurrency 8 (realistic rush)
 *   node scripts/stress-test.js 50 attendance 50    # full blast (worst case)
 *
 * Tip: use a throwaway spreadsheet / clear the Attendance tab after.
 */

import "dotenv/config";

const count = Math.max(1, Number(process.argv[2] || 10));
const type = (process.argv[3] || "attendance").toLowerCase();
const concurrency = Math.max(1, Number(process.argv[4] || 8));
const webhookUrl = process.env.SHEETS_WEBHOOK_URL;
const secret = process.env.SHEETS_WEBHOOK_SECRET;
const maxAttempts = 6;

if (!webhookUrl || !secret) {
  console.error("Set SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET in .env first.");
  process.exit(1);
}

if (type !== "attendance" && type !== "checkout") {
  console.error('Type must be "attendance" or "checkout".');
  process.exit(1);
}

function fakeId(i) {
  return String(900000000000000000n + BigInt(i));
}

function payload(i, meetingId) {
  const id = fakeId(i);
  const base = {
    secret,
    type,
    timestamp: new Date().toISOString(),
    discordUserId: id,
    discordUsername: `stress_user_${i}`,
    displayName: `Stress Student ${i}`,
    guildId: process.env.DISCORD_GUILD_ID || "stress-test-guild",
  };

  if (type === "attendance") {
    // One shared meeting id for the whole run (simulates one end-of-meeting passphrase)
    return { ...base, meetingId };
  }

  return {
    ...base,
    checkoutKey: `T${String(i).padStart(5, "0")}`,
    approvedById: "mentor-stress-test",
    approvedByUsername: "stress_mentor",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function oneRequest(i, meetingId) {
  const started = performance.now();
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(i, meetingId)),
        redirect: "follow",
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        lastError = text;
        await sleep(attempt * 1000);
        continue;
      }

      if (res.ok && json.ok === true) {
        return {
          i,
          ok: true,
          ms: performance.now() - started,
          attempts: attempt,
          error: null,
        };
      }

      lastError = json.error || text;
      if (String(lastError).toLowerCase().includes("busy") && attempt < maxAttempts) {
        await sleep(attempt * 1000);
        continue;
      }
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await sleep(attempt * 1000);
        continue;
      }
    }
  }

  return {
    i,
    ok: false,
    ms: performance.now() - started,
    attempts: maxAttempts,
    error: lastError,
  };
}

/** Run promises with a max concurrency pool. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[idx];
}

console.log(
  `Firing ${count} "${type}" webhook requests (concurrency ${concurrency}, retries on busy)…`,
);
console.log("Webhook URL: [redacted]");
const sharedMeetingId = `stress-meeting-${Date.now()}`;
if (type === "attendance") {
  console.log(`Shared meeting ID for this run: ${sharedMeetingId}`);
}
const wallStart = performance.now();

const results = await mapPool(
  Array.from({ length: count }, (_, i) => i + 1),
  concurrency,
  (i) => oneRequest(i, sharedMeetingId),
);

const wallMs = performance.now() - wallStart;
const oks = results.filter((r) => r.ok);
const fails = results.filter((r) => !r.ok);
const times = results.map((r) => r.ms).sort((a, b) => a - b);

console.log("");
console.log("=== Results ===");
console.log(`Success: ${oks.length}/${count}`);
console.log(`Failed:  ${fails.length}/${count}`);
console.log(`Wall time: ${(wallMs / 1000).toFixed(2)}s`);
console.log(`Latency p50: ${percentile(times, 50).toFixed(0)}ms`);
console.log(`Latency p95: ${percentile(times, 95).toFixed(0)}ms`);
console.log(`Latency max: ${times[times.length - 1]?.toFixed(0) ?? 0}ms`);

if (fails.length) {
  console.log("");
  console.log("First failures:");
  for (const f of fails.slice(0, 10)) {
    console.log(`  #${f.i}: ${f.error}`);
  }
}

console.log("");
console.log("Check your Google Sheet for row count (should match Success).");
console.log(
  "Realistic rush: concurrency 5–10. Worst case blast: concurrency = count.",
);
