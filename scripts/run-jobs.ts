import { processJobs, outboxStats } from '../src/server/jobs';
import { getSql } from '../src/server/db';

processJobs({ limit: 100 })
  .then(async (r) => console.log(JSON.stringify({ processed: r.length, stats: await outboxStats() })))
  .catch((e) => {
    console.error('Job run failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
