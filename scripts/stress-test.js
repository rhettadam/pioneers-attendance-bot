/**
 * Seed a multi-day season into Google Sheets via the Apps Script webhook.
 * Mixes attendance, checkouts, and comps so you can verify Season aggregation.
 *
 * Usage:
 *   npm run stress-test
 *   node scripts/stress-test.js
 *   node scripts/stress-test.js 5          # concurrency (default 5)
 *
 * Does NOT go through Discord. Clear stress rows afterward if needed
 * (Discord IDs start with 910000000000000000).
 *
 * After running, add the printed Meetings rows to your Meetings tab.
 */

import "dotenv/config";

const concurrency = Math.max(1, Number(process.argv[2] || 5));
const webhookUrl = process.env.SHEETS_WEBHOOK_URL;
const secret = process.env.SHEETS_WEBHOOK_SECRET;
const guildId = process.env.DISCORD_GUILD_ID || "stress-test-guild";
const maxAttempts = 6;

if (!webhookUrl || !secret) {
  console.error("Set SHEETS_WEBHOOK_URL and SHEETS_WEBHOOK_SECRET in .env first.");
  process.exit(1);
}

/** Season calendar — paste these into the Meetings sheet */
const MEETINGS = [
  { day: "2026-01-05", weight: 1, notes: "Mon" },
  { day: "2026-01-07", weight: 1, notes: "Wed" },
  { day: "2026-01-09", weight: 1, notes: "Fri" },
  { day: "2026-01-10", weight: 2, notes: "Sat (doubled)" },
  { day: "2026-01-12", weight: 1, notes: "Mon" },
  { day: "2026-01-14", weight: 1, notes: "Wed" },
];

const DAYS = MEETINGS.map((m) => m.day);
const CAPACITY = MEETINGS.reduce((sum, m) => sum + m.weight, 0); // 7

/**
 * Students with deliberately different credit profiles.
 * Patterns use day index into DAYS.
 */
const STUDENTS = [
  {
    n: 1,
    name: "Perfect Pete",
    // All 6 days attended → weighted 7 / 7 = 100%
    attend: [0, 1, 2, 3, 4, 5],
    checkout: [],
    comp: [],
  },
  {
    n: 2,
    name: "High Hannah",
    // Miss Fri only → 5 days, weighted 6 / 7 ≈ 86%
    attend: [0, 1, 3, 4, 5],
    checkout: [],
    comp: [],
  },
  {
    n: 3,
    name: "Checkout Chris",
    // Early leave Mon+Wed, attend Sat+Fri → days 0,1,2,3 weighted 5 / 7 ≈ 71%
    attend: [2, 3],
    checkout: [0, 1],
    comp: [],
  },
  {
    n: 4,
    name: "Comp Casey",
    // Miss most; comps for Mon+Wed; attend Sat → days 0,1,3 weighted 4 / 7 ≈ 57%
    attend: [3],
    checkout: [],
    comp: [
      { dayIndex: 0, reason: "family obligation" },
      { dayIndex: 1, reason: "school event" },
    ],
  },
  {
    n: 5,
    name: "Mixed Morgan",
    // Attend Mon+Fri, checkout Wed, comp second Mon → 0,1,2,4 weighted 4 / 7 ≈ 57%
    attend: [0, 2],
    checkout: [1],
    comp: [{ dayIndex: 4, reason: "illness" }],
  },
  {
    n: 6,
    name: "Saturday Sam",
    // Only doubled Saturday → weighted 2 / 7 ≈ 29%
    attend: [3],
    checkout: [],
    comp: [],
  },
  {
    n: 7,
    name: "Low Riley",
    // Single Wed attend → 1 / 7 ≈ 14%
    attend: [5],
    checkout: [],
    comp: [],
  },
  {
    n: 8,
    name: "Overlap Olivia",
    // Attend + checkout same day should still be 1 credited day (union)
    // Wed attend + Wed checkout + Fri attend → days 1,2 weighted 2 / 7 ≈ 29%
    attend: [1, 2],
    checkout: [1],
    comp: [],
  },
];

function studentId(n) {
  return String(910000000000000000n + BigInt(n));
}

function meetingIdForDay(day) {
  return `stress-meeting-${day}`;
}

function isoForDay(day, hour = 20) {
  return `${day}T${String(hour).padStart(2, "0")}:15:00.000Z`;
}

function buildEvents() {
  /** @type {Array<Record<string, string>>} */
  const events = [];

  for (const s of STUDENTS) {
    const id = studentId(s.n);
    const username = `stress_${s.n}`;

    for (const di of s.attend) {
      const day = DAYS[di];
      events.push({
        type: "attendance",
        timestamp: isoForDay(day, 20),
        discordUserId: id,
        discordUsername: username,
        displayName: s.name,
        meetingDay: day,
        meetingId: meetingIdForDay(day),
        guildId,
        _label: `${s.name} attend ${day}`,
      });
    }

    for (const di of s.checkout) {
      const day = DAYS[di];
      events.push({
        type: "checkout",
        timestamp: isoForDay(day, 18),
        discordUserId: id,
        discordUsername: username,
        displayName: s.name,
        meetingDay: day,
        checkoutKey: `S${s.n}${di}${day.replaceAll("-", "").slice(-4)}`,
        approvedById: "910000000000000099",
        approvedByUsername: "stress_mentor",
        guildId,
        _label: `${s.name} checkout ${day}`,
      });
    }

    for (const c of s.comp) {
      const day = DAYS[c.dayIndex];
      events.push({
        type: "comp",
        timestamp: isoForDay(day, 21),
        discordUserId: id,
        discordUsername: username,
        displayName: s.name,
        meetingDay: day,
        reason: c.reason,
        approvedById: "910000000000000099",
        approvedByUsername: "stress_mentor",
        guildId,
        _label: `${s.name} comp ${day}`,
      });
    }
  }

  return events;
}

function expectedForStudent(s) {
  const credited = new Set([
    ...s.attend.map((i) => DAYS[i]),
    ...s.checkout.map((i) => DAYS[i]),
    ...s.comp.map((c) => DAYS[c.dayIndex]),
  ]);
  let weighted = 0;
  for (const day of credited) {
    weighted += MEETINGS.find((m) => m.day === day)?.weight ?? 0;
  }
  const pct = CAPACITY === 0 ? 0 : weighted / CAPACITY;
  return {
    name: s.name,
    attended: s.attend.length,
    checkouts: s.checkout.length,
    comps: s.comp.length,
    creditedDays: credited.size,
    weighted,
    pct,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postEvent(event) {
  const started = performance.now();
  const { _label, ...row } = event;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, ...row }),
        redirect: "follow",
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        lastError = text.slice(0, 120);
        await sleep(attempt * 800);
        continue;
      }

      if (res.ok && json.ok === true) {
        return { label: _label, ok: true, ms: performance.now() - started };
      }

      lastError = json.error || text.slice(0, 120);
      if (String(lastError).toLowerCase().includes("busy") && attempt < maxAttempts) {
        await sleep(attempt * 800);
        continue;
      }
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await sleep(attempt * 800);
        continue;
      }
    }
  }

  return {
    label: _label,
    ok: false,
    ms: performance.now() - started,
    error: lastError,
  };
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

const events = buildEvents();

console.log("Season stress seed");
console.log("Webhook URL: [redacted]");
console.log(`Events: ${events.length} (concurrency ${concurrency})`);
console.log("");
console.log("Add these rows to the Meetings tab:");
console.log("Meeting Day\tWeight\tNotes");
for (const m of MEETINGS) {
  console.log(`${m.day}\t${m.weight}\t${m.notes}`);
}
console.log(`Season capacity (weighted): ${CAPACITY}`);
console.log("");
console.log("Expected Season rows (approx):");
console.log(
  "Name\tAttended\tCheckout\tComp\tCredited days\tWeighted\t% combined",
);
for (const s of STUDENTS) {
  const e = expectedForStudent(s);
  console.log(
    [
      e.name,
      e.attended,
      e.checkouts,
      e.comps,
      e.creditedDays,
      e.weighted,
      `${(e.pct * 100).toFixed(0)}%`,
    ].join("\t"),
  );
}
console.log("");
console.log(
  "Note: Attended/Checkout/Comp columns are event counts; Credited days is the union of days.",
);
console.log("Overlap Olivia has attend+checkout on the same Wed → credited days still 2 total.");
console.log("");

const wallStart = performance.now();
const results = await mapPool(events, concurrency, (ev) => postEvent(ev));
const wallMs = performance.now() - wallStart;

const oks = results.filter((r) => r.ok);
const fails = results.filter((r) => !r.ok);

console.log("=== Write results ===");
console.log(`Success: ${oks.length}/${events.length}`);
console.log(`Failed:  ${fails.length}/${events.length}`);
console.log(`Wall time: ${(wallMs / 1000).toFixed(2)}s`);

if (fails.length) {
  console.log("");
  console.log("Failures:");
  for (const f of fails.slice(0, 15)) {
    console.log(`  ${f.label}: ${f.error}`);
  }
}

console.log("");
console.log("Refresh the Season tab and compare to the expected table above.");
console.log("Stress Discord IDs are 91000000000000000x — filter/delete those rows to clean up.");
