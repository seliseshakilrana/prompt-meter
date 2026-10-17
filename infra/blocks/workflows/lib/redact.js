// Prompt preview cleaning, repeated server-side (PLAN.md "Clean the preview twice").
// Order matters: secrets are removed BEFORE the 100-character cut, so a secret that
// straddles the cut can never leave a readable fragment behind.
//
// Shared helper: function declarations only. Inlined into code nodes by build.js.

const PREVIEW_MAX_CHARS = 100;
const REDACTED = "[redacted]";

function redactSecrets(text) {
  let s = String(text);
  // PEM private key blocks (also an unterminated one at the end of the text).
  s = s.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, REDACTED);
  // Credentials embedded in URLs: scheme://user:pass@host
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@\/]+:[^\s@\/]+@/gi, "$1" + REDACTED + "@");
  // Authorization header values.
  s = s.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+\/=-]{12,}/gi, "$1 " + REDACTED);
  // key=value / key: value where the key name looks secret.
  // Plain numbers are kept so text like "tokens: 5000" survives.
  s = s.replace(
    /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|credentials?)[A-Za-z0-9_.-]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    function (match, name, sep, value) {
      if (/^[0-9.,]+$/.test(value)) return match;
      return name + sep + REDACTED;
    }
  );
  // Known token shapes.
  const patterns = [
    /\bpm_[a-z0-9]{8}_[A-Za-z0-9]{32}\b/g,            // prompt-meter ingest keys
    /\bsk-ant-[A-Za-z0-9_-]{10,}/g,                    // Anthropic
    /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/g, // OpenAI
    /\bAIza[0-9A-Za-z_-]{30,}/g,                       // Google API keys
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,                  // AWS access key ids
    /\bgh[pousr]_[A-Za-z0-9]{30,}/g,                   // GitHub tokens
    /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                 // Slack
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g // JWT
  ];
  for (let i = 0; i < patterns.length; i++) s = s.replace(patterns[i], REDACTED);
  // Long high-entropy runs (hex digests, base64 blobs) that mix letters and digits.
  s = s.replace(/[A-Za-z0-9+\/_-]{32,}={0,2}/g, function (run) {
    return /[0-9]/.test(run) && /[A-Za-z]/.test(run) ? REDACTED : run;
  });
  return s;
}

// Returns the cleaned preview (<= 100 characters) or null.
function cleanPreview(text, sendPreview) {
  if (sendPreview === false) return null;
  if (text === null || text === undefined) return null;
  if (typeof text !== "string") return null;
  const cleaned = redactSecrets(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const chars = Array.from(cleaned);
  return chars.length > PREVIEW_MAX_CHARS ? chars.slice(0, PREVIEW_MAX_CHARS).join("") : cleaned;
}
