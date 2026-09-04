/**
 * Append a row via a Google Apps Script Web App over HTTPS only.
 * Retries when the sheet lock is busy under concurrent load.
 * Errors are coded for internal handling — never expose URLs/secrets to Discord.
 *
 * @param {{
 *   webhookUrl: string,
 *   webhookSecret: string,
 *   type: "attendance" | "checkout",
 *   row: Record<string, string>,
 * }} args
 */
export async function appendSheetRow({
  webhookUrl,
  webhookSecret,
  type,
  row,
}) {
  assertHttps(webhookUrl);

  const maxAttempts = 6;
  let lastCode = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchHttpsOnly(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Secret travels in the TLS-encrypted JSON body — never as a query param
        body: JSON.stringify({
          secret: webhookSecret,
          type,
          ...row,
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
        return;
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
    // Redirects after POST to Apps Script are typically GET to the result page
    return fetchHttpsOnly(next.toString(), { method: "GET", redirect: "manual" }, hop + 1);
  }

  return res;
}

function backoffMs(attempt) {
  return attempt * 1000 + Math.floor(Math.random() * 250);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
