import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Runtime mode: CI pipeline or local developer CLI.
 */
export type Mode = 'ci' | 'local-cli';

/**
 * Validated, frozen configuration object for the sync script.
 */
export interface Config {
  mode: Mode;
  feishuAppToken: string;
  feishuTableId: string;
  repoRoot: string;
  projectPath: string;
  commitSha: string;
  pipelineId: string;
  jobId: string;
  gitlabBaseUrl: string;
  removedProtectionThreshold: number;
  dryRun: boolean;
  forceSync: boolean;
  csvOutputPath: string | null;
}

/**
 * Detect execution mode based on CI environment variables.
 * CI mode if CI=true OR CI_PROJECT_DIR is set.
 */
function detectMode(env: NodeJS.ProcessEnv): Mode {
  const isCi = env.CI === 'true' || !!env.CI_PROJECT_DIR;
  return isCi ? 'ci' : 'local-cli';
}

/**
 * Run a git command in the given directory, returning stdout trimmed.
 * Returns empty string on any failure.
 */
function gitExec(args: string, cwd: string): string {
  try {
    return execSync(`git -C ${cwd} ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Try to parse project path from git remote origin URL.
 * Handles both SSH (git@host:group/project.git) and HTTPS (https://host/group/project.git) formats.
 * Returns empty string on failure.
 */
function parseProjectPathFromRemote(repoRoot: string): string {
  const remoteUrl = gitExec('remote get-url origin', repoRoot);
  if (!remoteUrl) return '';

  // SSH format: git@gitlab.example.com:group/project.git
  const sshMatch = remoteUrl.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS format: https://gitlab.example.com/group/project.git
  try {
    const url = new URL(remoteUrl);
    const pathname = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
    return pathname || '';
  } catch {
    return '';
  }
}

/**
 * Try to parse gitlab base URL from git remote origin URL.
 * Returns empty string on failure or if not https.
 */
function parseGitlabBaseUrlFromRemote(repoRoot: string): string {
  const remoteUrl = gitExec('remote get-url origin', repoRoot);
  if (!remoteUrl) return '';

  // SSH format: git@gitlab.example.com:group/project.git → https://gitlab.example.com
  const sshMatch = remoteUrl.match(/^git@([^:]+):/);
  if (sshMatch) return `https://${sshMatch[1]}`;

  // HTTPS format: https://gitlab.example.com/group/project.git → https://gitlab.example.com
  try {
    const url = new URL(remoteUrl);
    if (url.protocol === 'https:') {
      return `${url.protocol}//${url.host}`;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Load .env files in local-cli mode only.
 * Priority: process.env > <Repo_Root>/.env > script dir .env
 * dotenv does NOT override existing env vars (override: false).
 */
function loadDotenvFiles(repoRoot: string): void {
  // Try script directory .env first (scripts/.env — this is where config lives)
  const scriptDirEnvPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    '.env',
  );
  if (existsSync(scriptDirEnvPath)) {
    dotenvConfig({ path: scriptDirEnvPath, override: false });
  }

  // Then try <Repo_Root>/.env as supplementary
  const repoEnvPath = path.join(repoRoot, '.env');
  if (existsSync(repoEnvPath) && repoEnvPath !== scriptDirEnvPath) {
    dotenvConfig({ path: repoEnvPath, override: false });
  }
}

/**
 * Parse a Feishu Bitable URL into app_token and table_id.
 * Format: https://xxx.feishu.cn/base/<APP_TOKEN>?table=<TABLE_ID>&...
 */
function parseFeishuUrl(url: string): { appToken: string; tableId: string } | null {
  try {
    const u = new URL(url);
    const pathMatch = u.pathname.match(/\/base\/([^/?]+)/);
    const tableId = u.searchParams.get('table');
    if (pathMatch && tableId) {
      return { appToken: pathMatch[1], tableId };
    }
  } catch { /* not a valid URL */ }
  return null;
}

/**
 * Zod schema for validating required environment variables.
 */
const envSchema = z.object({
  FEISHU_TABLE_URL: z.string().optional().default(''),
  FEISHU_APP_TOKEN: z.string().optional().default(''),
  FEISHU_TABLE_ID: z.string().optional().default(''),
  GITLAB_BASE_URL: z.string().optional().default(''),
  REMOVED_PROTECTION_THRESHOLD: z.string().optional().default('0.30'),
  DRY_RUN: z.string().optional().default('false'),
  FORCE_SYNC: z.string().optional().default('false'),
  CSV_OUTPUT_PATH: z.string().optional().default(''),
});

/**
 * Load and validate configuration from environment variables.
 *
 * - Detects mode (ci vs local-cli) based on CI / CI_PROJECT_DIR env vars.
 * - In local-cli mode, loads .env files (Repo_Root/.env then script dir .env).
 * - Validates all required env vars with zod schema.
 * - In local-cli mode, falls back to git commands for projectPath, commitSha, gitlabBaseUrl.
 * - Rejects http:// for GITLAB_BASE_URL (must be https:// or empty).
 * - Freezes the resulting Config object.
 * - Prints missing field names on failure (never values), exits non-zero.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const mode = detectMode(env);

  // Determine repoRoot early for dotenv loading
  let repoRoot: string;
  if (mode === 'ci') {
    repoRoot = env.CI_PROJECT_DIR || process.cwd();
  } else {
    repoRoot = env.REPO_ROOT || process.cwd();
  }

  // Load .env files in local-cli mode only
  if (mode === 'local-cli') {
    loadDotenvFiles(repoRoot);
  }

  // Re-read repoRoot after dotenv (REPO_ROOT may come from .env)
  if (mode === 'local-cli' && process.env.REPO_ROOT) {
    repoRoot = process.env.REPO_ROOT;
  }

  // After dotenv loading, re-read env (dotenv populates process.env)
  const effectiveEnv = process.env;

  // Validate required fields
  const parseResult = envSchema.safeParse({
    FEISHU_TABLE_URL: effectiveEnv.FEISHU_TABLE_URL,
    FEISHU_APP_TOKEN: effectiveEnv.FEISHU_APP_TOKEN,
    FEISHU_TABLE_ID: effectiveEnv.FEISHU_TABLE_ID,
    GITLAB_BASE_URL: effectiveEnv.GITLAB_BASE_URL,
    REMOVED_PROTECTION_THRESHOLD: effectiveEnv.REMOVED_PROTECTION_THRESHOLD,
    DRY_RUN: effectiveEnv.DRY_RUN,
    FORCE_SYNC: effectiveEnv.FORCE_SYNC,
    CSV_OUTPUT_PATH: effectiveEnv.CSV_OUTPUT_PATH,
  });

  if (!parseResult.success) {
    const missingFields = parseResult.error.issues.map((issue) => issue.path.join('.'));
    process.stderr.write(
      `[feisync] Config validation failed. Missing or invalid fields: ${missingFields.join(', ')}\n`,
    );
    process.exit(1);
  }

  const validated = parseResult.data;

  // Resolve projectPath: CI_PROJECT_PATH or parse from git remote
  let projectPath = effectiveEnv.CI_PROJECT_PATH || '';
  if (!projectPath) {
    projectPath = parseProjectPathFromRemote(repoRoot);
  }

  // Resolve commitSha: CI_COMMIT_SHA or git rev-parse HEAD
  let commitSha = effectiveEnv.CI_COMMIT_SHA || '';
  if (!commitSha) {
    commitSha = gitExec('rev-parse HEAD', repoRoot);
  }

  // Resolve gitlabBaseUrl
  let gitlabBaseUrl = validated.GITLAB_BASE_URL;
  if (!gitlabBaseUrl && mode === 'ci') {
    gitlabBaseUrl = effectiveEnv.CI_SERVER_URL || '';
  }
  if (!gitlabBaseUrl && mode === 'local-cli') {
    gitlabBaseUrl = parseGitlabBaseUrlFromRemote(repoRoot);
  }

  // URL validation: reject http:// (must be https:// or empty)
  if (gitlabBaseUrl && !gitlabBaseUrl.startsWith('https://')) {
    process.stderr.write(
      `[feisync] Config validation failed. GITLAB_BASE_URL must use https:// protocol.\n`,
    );
    process.exit(1);
  }

  // Parse numeric threshold
  const threshold = parseFloat(validated.REMOVED_PROTECTION_THRESHOLD);
  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    process.stderr.write(
      `[feisync] Config validation failed. REMOVED_PROTECTION_THRESHOLD must be a number between 0 and 1.\n`,
    );
    process.exit(1);
  }

  // Parse boolean flags
  const dryRun = validated.DRY_RUN.toLowerCase() === 'true';
  const forceSync = validated.FORCE_SYNC.toLowerCase() === 'true';

  // Parse optional CSV_OUTPUT_PATH (empty or whitespace-only → null)
  const csvOutputPath = validated.CSV_OUTPUT_PATH.trim() || null;

  // Extract CI context variables
  const pipelineId = effectiveEnv.CI_PIPELINE_ID || '';
  const jobId = effectiveEnv.CI_JOB_ID || '';

  // Resolve Feishu table identifiers: URL takes priority over individual vars
  let feishuAppToken = '';
  let feishuTableId = '';

  if (validated.FEISHU_TABLE_URL) {
    const parsed = parseFeishuUrl(validated.FEISHU_TABLE_URL);
    if (parsed) {
      feishuAppToken = parsed.appToken;
      feishuTableId = parsed.tableId;
    } else {
      process.stderr.write(
        `[feisync] Config validation failed. FEISHU_TABLE_URL format invalid. Expected: https://xxx.feishu.cn/base/<TOKEN>?table=<ID>\n`,
      );
      process.exit(1);
    }
  } else {
    feishuAppToken = validated.FEISHU_APP_TOKEN;
    feishuTableId = validated.FEISHU_TABLE_ID;
  }

  if (!feishuAppToken || !feishuTableId) {
    process.stderr.write(
      `[feisync] Config validation failed. Set FEISHU_TABLE_URL (full URL) or both FEISHU_APP_TOKEN + FEISHU_TABLE_ID.\n`,
    );
    process.exit(1);
  }

  const config: Config = {
    mode,
    feishuAppToken,
    feishuTableId,
    repoRoot,
    projectPath,
    commitSha,
    pipelineId,
    jobId,
    gitlabBaseUrl,
    removedProtectionThreshold: threshold,
    dryRun,
    forceSync,
    csvOutputPath,
  };

  return Object.freeze(config);
}
