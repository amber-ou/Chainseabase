/**
 * Structured logging. Never pass tokens, invitation links, OAuth codes, private
 * text bodies or credentials here; callers pass identifiers and error classes only.
 */
const REDACT_KEYS = /token|secret|password|authorization|cookie|code|body|description|email/i;

function scrub(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = REDACT_KEYS.test(k) ? '[redacted]' : v;
  return out;
}

export function logInfo(event: string, meta: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_TESTS) return;
  console.log(JSON.stringify({ level: 'info', event, at: new Date().toISOString(), ...scrub(meta) }));
}

export function logError(event: string, err: unknown, meta: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_TESTS) return;
  const e = err as { name?: string; code?: string; message?: string };
  console.error(JSON.stringify({
    level: 'error', event, at: new Date().toISOString(),
    errorName: e?.name, errorCode: e?.code,
    // messages from pg/fetch may contain SQL text but not parameters; keep short
    errorMessage: typeof e?.message === 'string' ? e.message.slice(0, 300) : undefined,
    ...scrub(meta),
  }));
}
