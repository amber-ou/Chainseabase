import { AsyncLocalStorage } from 'node:async_hooks';

/** Collects outbox job IDs created during a request so they can be processed after commit. */
export const jobCollector = new AsyncLocalStorage<string[]>();

export function collectJob(id: string) {
  jobCollector.getStore()?.push(id);
}
