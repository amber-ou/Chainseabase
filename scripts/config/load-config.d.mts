export type ConfigSource = 'config file' | '.env.local' | 'process';

export interface ResolvedConfig {
  values: Record<string, string>;
  sources: Record<string, ConfigSource>;
  configFile: string | null;
  fileSource: 'config file' | '.env.local' | null;
  appEnv: string;
  strict: boolean;
  problems: string[];
}

export const APP_KEYS: readonly string[];
export const NEXT_ENV_FILES: readonly string[];
export function parseConfigText(text: string, label?: string): { values: Record<string, string>; problems: string[] };
export function resolveConfig(opts?: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  platform?: string;
  fsImpl?: Pick<typeof import('node:fs'), 'existsSync' | 'readFileSync' | 'statSync'>;
}): ResolvedConfig;
export function describeSources(resolved: ResolvedConfig): { name: string; source: ConfigSource | '-' }[];
export function applyConfigOrExit(): ResolvedConfig;
