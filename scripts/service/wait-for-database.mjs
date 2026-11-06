// WIN-03: wait for PostgreSQL before the website starts. At boot the database service may still be
// starting (connection refused, or 57P03 "the database system is starting up"): retry with backoff.
// Errors that waiting cannot fix (wrong password, missing database) stop immediately.
// Log lines carry error classes only, never the connection string or password.

/** Error codes that mean "not ready yet". */
const RETRYABLE = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'EPIPE',
  'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED',
  '57P03', // cannot_connect_now: starting up / shutting down / recovery
  '57P01', // admin_shutdown (restart in progress)
  '53300', // too_many_connections
]);

export function isRetryable(err) {
  const code = err && typeof err === 'object' ? err.code : undefined;
  return typeof code === 'string' && RETRYABLE.has(code);
}

/**
 * @param {object} o
 * @param {() => Promise<void>} o.probe one connection attempt (resolves when the database answers)
 * @param {number} o.maxWaitMs give up after this long
 * @param {(line: object) => void} o.log
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {() => number} [o.now]
 * @returns {Promise<{ ok: true, attempts: number } | { ok: false, attempts: number, reason: 'timeout' | 'fatal', code: string }>}
 */
export async function waitForDatabase({ probe, maxWaitMs, log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
  const started = now();
  let attempt = 0;
  let delay = 1000;
  for (;;) {
    attempt++;
    try {
      await probe();
      log({ level: 'info', event: 'db.ready', attempt, waitedMs: now() - started });
      return { ok: true, attempts: attempt };
    } catch (err) {
      const code = (err && typeof err === 'object' && typeof err.code === 'string') ? err.code : 'UNKNOWN';
      if (!isRetryable(err)) {
        log({ level: 'error', event: 'db.unavailable', reason: 'fatal', attempt, errorCode: code });
        return { ok: false, attempts: attempt, reason: 'fatal', code };
      }
      const waited = now() - started;
      if (waited + delay > maxWaitMs) {
        log({ level: 'error', event: 'db.unavailable', reason: 'timeout', attempt, errorCode: code, waitedMs: waited });
        return { ok: false, attempts: attempt, reason: 'timeout', code };
      }
      log({ level: 'warn', event: 'db.wait', attempt, errorCode: code, retryInMs: delay });
      await sleep(delay);
      delay = Math.min(delay * 2, 15000);
    }
  }
}
