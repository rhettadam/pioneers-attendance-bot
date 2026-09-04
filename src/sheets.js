/**
 * Append a row via a Google Apps Script Web App.
 * Retries when the sheet lock is busy under concurrent load.
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
  const maxAttempts = 6;
  let lastError = "Unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: webhookSecret,
          type,
          ...row,
        }),
        redirect: "follow",
      });

      const text = await res.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        lastError = `Sheets webhook bad response (${res.status}): ${text}`;
        // Non-JSON is usually a transient Apps Script blip — retry
        await sleep(backoffMs(attempt));
        continue;
      }

      if (res.ok && payload.ok === true) {
        return;
      }

      lastError = payload.error || text;
      const busy = String(lastError).toLowerCase().includes("busy");
      if (busy && attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }

      throw new Error(`Sheets webhook failed (${res.status}): ${lastError}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Sheets webhook failed")) {
        throw err;
      }
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new Error(`Sheets webhook failed: ${lastError}`);
    }
  }

  throw new Error(`Sheets webhook failed after retries: ${lastError}`);
}

function backoffMs(attempt) {
  // 1s, 2s, 3s, 4s, 5s (+ small jitter)
  return attempt * 1000 + Math.floor(Math.random() * 250);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
