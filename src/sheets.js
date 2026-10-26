/**
 * Talk to the Google Apps Script Web App over HTTPS only.
 * Writes are queued in-process so 50 check-ins do not stampede the sheet lock.
 * Reads (`status`) skip the queue.
 * Errors are coded for internal handling — never expose URLs/secrets to Discord.
 */

let writeTail = Promise.resolve();

function enqueueWrite(work) {
  const run = writeTail.then(work, work);
  writeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * @param {{
 *   webhookUrl: string,
 *   webhookSecret: string,
 *   type: "attendance" | "checkout" | "comp" | "raised",
 *   row: Record<string, string | number>,
 * }} args
 * @returns {Promise<{ ok: true, added?: number, duplicates?: number, duplicate?: boolean }>}
 */
export async function appendSheetRow({
  webhookUrl,
  webhookSecret,
  type,
  row,
}) {
  return enqueueWrite(() =>
    postSheetJson({
      webhookUrl,
      webhookSecret,
      body: { type, ...row },
    }),
  );
}

/**
 * @param {{
 *   webhookUrl: string,
 *   webhookSecret: string,
 *   type: "comp" | "raised",
 *   students: Record<string, string | number>[],
 * }} args
 * @returns {Promise<{ ok: true, added?: number, duplicates?: number, duplicate?: boolean }>}
 */
export async function appendSheetRows({
  webhookUrl,
  webhookSecret,
  type,
  students,
}) {
  return enqueueWrite(() =>
    postSheetJson({
      webhookUrl,
      webhookSecret,
      body: { type, students },
    }),
  );
}

/**
 * @param {{
 *   webhookUrl: string,
 *   webhookSecret: string,
 *   discordUserId: string,
 * }} args
 */
export async function fetchStudentStatus({
  webhookUrl,
  webhookSecret,
  discordUserId,
}) {
  return postSheetJson({
    webhookUrl,
    webhookSecret,
    body: { type: "status", discordUserId },
  });
}

/**
 * @param {{
 *   webhookUrl: string,
 *   webhookSecret: string,
 *   body: Record<string, unknown>,
 * }} args
 */
async function postSheetJson({ webhookUrl, webhookSecret, body }) {
  assertHttps(webhookUrl);

  const maxAttempts = 8;
  let lastCode = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchHttpsOnly(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: webhookSecret,
          ...body,
        }),
      });

      const text = await res.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        lastCode = `bad_response_${res.status}`;
        await sleep(backoffMs(attempt));
        continue;
      }

      if (res.ok && payload.ok === true) {
        return payload;
      }

      const errText = String(payload.error || "");
      const busy = errText.toLowerCase().includes("busy");
      lastCode = busy ? "busy" : `rejected_${res.status}`;

      if (busy && attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }

      const error = new Error("SHEETS_WRITE_FAILED");
      error.code = lastCode;
      throw error;
    } catch (err) {
      if (err instanceof Error && err.message === "SHEETS_WRITE_FAILED") {
        throw err;
      }
      if (err instanceof Error && err.message === "INSECURE_REDIRECT") {
        const error = new Error("SHEETS_WRITE_FAILED");
        error.code = "insecure_redirect";
        throw error;
      }
      lastCode = "network";
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      const error = new Error("SHEETS_WRITE_FAILED");
      error.code = lastCode;
      throw error;
    }
  }

  const error = new Error("SHEETS_WRITE_FAILED");
  error.code = lastCode;
  throw error;
}

function assertHttps(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    const error = new Error("SHEETS_WRITE_FAILED");
    error.code = "insecure_url";
    throw error;
  }
}

/**
 * Follow redirects manually and refuse any non-HTTPS hop.
 */
async function fetchHttpsOnly(url, init, hop = 0) {
  assertHttps(url);
  if (hop > 5) {
    const error = new Error("INSECURE_REDIRECT");
    throw error;
  }

  const res = await fetch(url, { ...init, redirect: "manual" });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) {
      throw new Error("INSECURE_REDIRECT");
    }
    const next = new URL(location, url);
    if (next.protocol !== "https:") {
      throw new Error("INSECURE_REDIRECT");
    }
    return fetchHttpsOnly(next.toString(), { method: "GET", redirect: "manual" }, hop + 1);
  }

  return res;
}

function backoffMs(attempt) {
  const base = Math.min(1600, 150 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 80);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
