export function isRetryable(err: unknown): boolean;
export function waitForDatabase(o: {
  probe: () => Promise<void>;
  maxWaitMs: number;
  log: (line: Record<string, unknown>) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<{ ok: true; attempts: number } | { ok: false; attempts: number; reason: 'timeout' | 'fatal'; code: string }>;
