/**
 * Youth-protection / secret-handling helpers.
 * Never put tokens, webhook URLs, secrets, or raw backend errors in Discord replies.
 */

const SENSITIVE =
  /(discord)?_?token|webhook|secret|private[_\s-]?key|authorization|bearer|password|passphrase|AKfycb|script\.google\.com\/macros/gi;

/**
 * Message shown to users in Discord. Always generic — no internals.
 */
export function userFacingError(_err) {
  return "Something went wrong while processing that. Please try again, or ask a mentor for help.";
}

/**
 * Log details for operators without dumping secrets into console/host logs.
 */
export function sanitizeForLog(value) {
  if (value == null) return String(value);
  if (value instanceof Error) {
    return sanitizeForLog(value.message);
  }
  let text = typeof value === "string" ? value : safeStringify(value);
  text = text.replace(SENSITIVE, "[redacted]");
  if (text.length > 500) {
    text = text.slice(0, 500) + "…";
  }
  return text;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logError(label, err) {
  console.error(label, sanitizeForLog(err));
}

/**
 * Reject anything that is not https:// before secrets go on the wire.
 * @param {string} url
 * @param {string} label
 * @returns {URL}
 */
export function assertHttpsUrl(url, label = "URL") {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`${label} is not a valid URL.`);
    process.exit(1);
  }
  if (parsed.protocol !== "https:") {
    console.error(`${label} must use https:// (refusing insecure transport).`);
    process.exit(1);
  }
  return parsed;
}
