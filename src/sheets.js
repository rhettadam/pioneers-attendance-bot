/**
 * Append a row via a Google Apps Script Web App.
 * No Google Cloud service-account keys required.
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
    throw new Error(`Sheets webhook bad response (${res.status}): ${text}`);
  }

  if (!res.ok || payload.ok !== true) {
    throw new Error(
      `Sheets webhook failed (${res.status}): ${payload.error || text}`,
    );
  }
}
