/**
 * Append a row via a Google Apps Script Web App.
 * No Google Cloud service-account keys required.
 *
 * @param {{
 *   webhookUrl: string,
 *   webhookSecret: string,
 *   row: {
 *     timestamp: string,
 *     discordUserId: string,
 *     discordUsername: string,
 *     displayName: string,
 *     passphrase: string,
 *     guildId: string,
 *   },
 * }} args
 */
export async function appendAttendanceRow({ webhookUrl, webhookSecret, row }) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: webhookSecret,
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
