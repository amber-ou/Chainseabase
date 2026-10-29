// WIN-03: Windows service entry point. WinSW runs `node.exe scripts/service/start-website.mjs`
// with an explicit working directory; no npm.cmd or cmd.exe sits between the service and Node.
//   1. load the configuration with the same loader as `npm start` and the CLI scripts;
//   2. wait for PostgreSQL with backoff (at boot it may still be starting);
//   3. run `next start` in this same process, on loopback only, and log once the site answers.
// Exit codes: 64 bad arguments, 70 the service wrapper exited (see --exit-with-parent),
// 75 database still unavailable (the service manager restarts us), 78 configuration refused or a
// database error that waiting cannot fix.
// Log lines are JSON with identifiers and error classes only, never secrets.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { applyConfigOrExit } from '../config/load-config.mjs';
import { waitForDatabase } from './wait-for-database.mjs';

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const log = (line) => console.log(JSON.stringify({ at: new Date().toISOString(), ...line }));

const port = Number(arg('port', '3000'));
const waitSeconds = Number(arg('db-wait-seconds', '600'));
const waitOnly = process.argv.includes('--wait-only');
// under the service: if the wrapper dies, this process must not live on unmanaged (it would hold
// the port, and every restarted instance would fail with EADDRINUSE)
const exitWithParent = process.argv.includes('--exit-with-parent');
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(waitSeconds) || waitSeconds < 0) {
  console.error('Usage: start-website.mjs [--port=3000] [--db-wait-seconds=600] [--wait-only] [--exit-with-parent]');
  process.exit(64);
}

if (exitWithParent) {
  const parent = process.ppid;
  const watch = setInterval(() => {
    try {
      process.kill(parent, 0); // existence check only, no signal is sent
    } catch (e) {
      if (e && e.code === 'ESRCH') {
        log({ level: 'error', event: 'service.wrapper_exited', parentPid: parent });
        process.exit(70);
      }
    }
  }, 2000);
  watch.unref();
}

applyConfigOrExit();
if (!process.env.DATABASE_URL) {
  log({ level: 'error', event: 'config.missing', name: 'DATABASE_URL' });
  process.exit(78);
}
log({ level: 'info', event: 'website.starting', port, pid: process.pid });

const result = await waitForDatabase({
  maxWaitMs: waitSeconds * 1000,
  log,
  probe: async () => {
    const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 1, onnotice: () => {} });
    try {
      await sql`select 1`;
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  },
});
if (!result.ok) process.exit(result.reason === 'fatal' ? 78 : 75);
if (waitOnly) process.exit(0);

// readiness evidence (e.g. "ready before anyone signed in after a reboot")
const startedAt = Date.now();
const readiness = setInterval(async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    if (r.status === 200) {
      clearInterval(readiness);
      log({ level: 'info', event: 'website.ready', port, startMs: Date.now() - startedAt });
    }
  } catch {
    // not listening yet
  }
}, 1000);
readiness.unref();

const nextBin = path.join(APP_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
process.argv = [process.argv[0], nextBin, 'start', '--hostname', '127.0.0.1', '-p', String(port)];
await import(pathToFileURL(nextBin).href);
