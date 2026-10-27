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
 * Secret-only ping. Does not touch the spreadsheet once Code.gs is redeployed.
 * @param {{ webhookUrl: string, webhookSecret: string }} args
 */
export async function checkSheetWebhook({ webhookUrl, webhookSecret }) {
  return postSheetJson({
    webhookUrl,
    webhookSecret,
    body: { type: "ping" },
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
  let lastDetail = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchHttpsOnly(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
        },
        body: JSON.stringify({
          secret: webhookSecret,
          ...body,
        }),
        signal: requestSignal(),
      });

      const text = await res.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        const classified = classifyBody(res.status, text, null);
        lastCode = classified.code;
        lastDetail = classified.detail;
        if (classified.retry && attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw fail(lastCode, lastDetail);
      }

      if (res.ok && payload.ok === true) {
        if (isDoGetProbe(payload) && body.type !== "ping") {
          lastCode = "hit_doget";
          lastDetail = "POST landed on doGet (redirect dropped the body)";
          if (attempt < maxAttempts) {
            await sleep(backoffMs(attempt));
            continue;
          }
          throw fail(lastCode, lastDetail);
        }
        return payload;
      }

      const classified = classifyBody(res.status, text, payload);
      lastCode = classified.code;
      lastDetail = classified.detail;
      if (classified.retry && attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw fail(lastCode, lastDetail);
    } catch (err) {
      if (err instanceof Error && err.message === "SHEETS_WRITE_FAILED") {
        throw err;
      }
      if (err instanceof Error && err.message === "INSECURE_REDIRECT") {
        throw fail("insecure_redirect");
      }
      lastCode = isTimeout(err) ? "timeout" : "network";
      lastDetail = err instanceof Error ? err.message : "request failed";
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw fail(lastCode, lastDetail);
    }
  }

  throw fail(lastCode, lastDetail);
}

function requestSignal() {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(20_000);
  }
  return undefined;
}

function fail(code, detail = "") {
  const error = new Error("SHEETS_WRITE_FAILED");
  error.code = code;
  if (detail) error.detail = String(detail).slice(0, 180);
  return error;
}

function isTimeout(err) {
  return Boolean(
    err &&
      typeof err === "object" &&
      "name" in err &&
      (err.name === "TimeoutError" || err.name === "AbortError"),
  );
}

function isDoGetProbe(payload) {
  return (
    typeof payload?.message === "string" &&
    payload.message.toLowerCase().includes("webhook is live")
  );
}

function classifyBody(status, text, payload) {
  if (payload && typeof payload === "object") {
    const errText = String(payload.error || "");
    const lower = errText.toLowerCase();
    if (lower.includes("busy")) {
      return { code: "busy", detail: errText, retry: true };
    }
    if (lower.includes("unauthorized")) {
      return { code: "unauthorized", detail: errText, retry: false };
    }
    if (lower.includes("missing sheet tab")) {
      return { code: "missing_tab", detail: errText, retry: false };
    }
    if (lower.includes("timed out") || lower.includes("exceeded maximum")) {
      return { code: "sheet_timeout", detail: errText, retry: true };
    }
    return {
      code: `rejected_${status}`,
      detail: errText || `HTTP ${status}`,
      retry: false,
    };
  }

  const snippet = String(text || "").replace(/\s+/g, " ").slice(0, 120);
  if (
    /<html/i.test(text) ||
    /sign in/i.test(text) ||
    /accounts\.google/i.test(text) ||
    /unverified/i.test(text)
  ) {
    return {
      code: "google_auth_page",
      detail: "Google returned a login/authorization page instead of JSON",
      retry: false,
    };
  }
  return {
    code: `bad_response_${status}`,
    detail: snippet || `HTTP ${status}`,
    retry: true,
  };
}

function assertHttps(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw fail("insecure_url");
  }
}

/**
 * Follow redirects manually and refuse any non-HTTPS hop.
 * If the runtime hides Location, fall back to automatic HTTPS follow.
 */
async function fetchHttpsOnly(url, init, hop = 0) {
  assertHttps(url);
  if (hop > 5) {
    throw new Error("INSECURE_REDIRECT");
  }

  const res = await fetch(url, { ...init, redirect: "manual" });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location");
    if (!location) {
      return fetch(url, { ...init, redirect: "follow" });
    }
    const next = new URL(location, url);
    if (next.protocol !== "https:") {
      throw new Error("INSECURE_REDIRECT");
    }
    const replay = res.status === 307 || res.status === 308;
    return fetchHttpsOnly(
      next.toString(),
      replay ? { ...init } : { method: "GET", signal: init?.signal },
      hop + 1,
    );
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
