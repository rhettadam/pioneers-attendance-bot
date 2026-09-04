import { createSign } from "node:crypto";

function normalizePem(privateKey) {
  return privateKey.includes("\\n")
    ? privateKey.replace(/\\n/g, "\n")
    : privateKey;
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getAccessToken(email, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned =
    base64UrlEncode(JSON.stringify(header)) +
    "." +
    base64UrlEncode(JSON.stringify(claim));

  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(normalizePem(privateKeyPem));
  const jwt = unsigned + "." + base64UrlEncode(signature);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token error (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * @param {{
 *   sheetId: string,
 *   tabName: string,
 *   serviceAccountEmail: string,
 *   privateKey: string,
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
export async function appendAttendanceRow({
  sheetId,
  tabName,
  serviceAccountEmail,
  privateKey,
  row,
}) {
  const token = await getAccessToken(serviceAccountEmail, privateKey);
  const range = encodeURIComponent(`${tabName}!A:F`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      values: [
        [
          row.timestamp,
          row.discordUserId,
          row.discordUsername,
          row.displayName,
          row.passphrase,
          row.guildId,
        ],
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Sheets append failed (${res.status}): ${await res.text()}`);
  }
}
