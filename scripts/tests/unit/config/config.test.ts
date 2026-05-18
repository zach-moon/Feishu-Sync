import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, type Config } from '@/config.js';

/**
 * Minimal valid env vars for tests.
 * Provides all required fields so tests can override specific ones.
 */
function validEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    FEISHU_APP_ID: 'cli_test1234',
    FEISHU_APP_SECRET: 'secret_test_value',
    FEISHU_APP_TOKEN: 'bascn_test_token',
    FEISHU_TABLE_ID: 'tbl_test_table',
    ...overrides,
  };
}

describe('config - loadConfig', () => {
  // Mock process.exit to prevent test runner from exiting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrMock: any;

  beforeEach(() => {
    exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    stderrMock = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never);
  });

  afterEach(() => {
    exitMock.mockRestore();
    stderrMock.mockRestore();
  });

  describe('mode detection', () => {
    it('should detect ci mode when CI=true', () => {
      const config = loadConfig(validEnv({ CI: 'true', CI_PROJECT_DIR: '/builds/project' }));
      expect(config.mode).toBe('ci');
    });

    it('should detect ci mode when CI_PROJECT_DIR is set (even without CI=true)', () => {
      const config = loadConfig(validEnv({ CI_PROJECT_DIR: '/builds/project' }));
      expect(config.mode).toBe('ci');
    });

    it('should detect local-cli mode when neither CI=true nor CI_PROJECT_DIR is set', () => {
      const config = loadConfig(validEnv());
      expect(config.mode).toBe('local-cli');
    });

    it('should detect local-cli mode when CI is not "true"', () => {
      const config = loadConfig(validEnv({ CI: 'false' }));
      expect(config.mode).toBe('local-cli');
    });
  });

  describe('required field validation', () => {
    it('should exit with error when FEISHU_APP_ID is missing', () => {
      const env = validEnv();
      delete env.FEISHU_APP_ID;

      expect(() => loadConfig(env)).toThrow('process.exit called');
      expect(stderrMock).toHaveBeenCalledWith(
        expect.stringContaining('FEISHU_APP_ID'),
      );
    });

    it('should exit with error when FEISHU_APP_SECRET is missing', () => {
      const env = validEnv();
      delete env.FEISHU_APP_SECRET;

      expect(() => loadConfig(env)).toThrow('process.exit called');
      expect(stderrMock).toHaveBeenCalledWith(
        expect.stringContaining('FEISHU_APP_SECRET'),
      );
    });

    it('should exit with error when FEISHU_APP_TOKEN is missing', () => {
      const env = validEnv();
      delete env.FEISHU_APP_TOKEN;

      expect(() => loadConfig(env)).toThrow('process.exit called');
      expect(stderrMock).toHaveBeenCalledWith(
        expect.stringContaining('FEISHU_APP_TOKEN'),
      );
    });

    it('should exit with error when FEISHU_TABLE_ID is missing', () => {
      const env = validEnv();
      delete env.FEISHU_TABLE_ID;

      expect(() => loadConfig(env)).toThrow('process.exit called');
      expect(stderrMock).toHaveBeenCalledWith(
        expect.stringContaining('FEISHU_TABLE_ID'),
      );
    });

    it('should print field names but never values on validation failure', () => {
      const env = validEnv();
      delete env.FEISHU_APP_SECRET;

      expect(() => loadConfig(env)).toThrow('process.exit called');

      const output = (stderrMock.mock.calls[0]?.[0] as string) || '';
      expect(output).toContain('FEISHU_APP_SECRET');
      expect(output).not.toContain('secret_test_value');
    });

    it('should exit with error when required field is empty string', () => {
      const env = validEnv({ FEISHU_APP_ID: '' });

      expect(() => loadConfig(env)).toThrow('process.exit called');
      expect(stderrMock).toHaveBeenCalledWith(
        expect.stringContaining('FEISHU_APP_ID'),
      );
    });
  });

  describe('GITLAB_BASE_URL validation', () => {
    it('should reject http:// URLs', () => {
      const env = validEnv({ GITLAB_BASE_URL: 'http://gitlab.example.com' });

      expect(() => loadConfig(env)).toThrow('process.exit called');
      expect(stderrMock).toHaveBeenCalledWith(
        expect.stringContaining('https://'),
      );
    });

    it('should accept https:// URLs', () => {
      const config = loadConfig(validEnv({ GITLAB_BASE_URL: 'https://gitlab.example.com' }));
      expect(config.gitlabBaseUrl).toBe('https://gitlab.example.com');
    });

    it('should accept empty GITLAB_BASE_URL', () => {
      const config = loadConfig(validEnv());
      // In local-cli mode without git remote, may be empty or derived from git
      expect(typeof config.gitlabBaseUrl).toBe('string');
    });

    it('should use CI_SERVER_URL in ci mode when GITLAB_BASE_URL is not set', () => {
      const config = loadConfig(validEnv({
        CI: 'true',
        CI_PROJECT_DIR: '/builds/project',
        CI_SERVER_URL: 'https://gitlab.ci.example.com',
      }));
      expect(config.gitlabBaseUrl).toBe('https://gitlab.ci.example.com');
    });
  });

  describe('optional fields parsing', () => {
    it('should parse CSV_OUTPUT_PATH as null when not set', () => {
      const config = loadConfig(validEnv());
      expect(config.csvOutputPath).toBeNull();
    });

    it('should parse CSV_OUTPUT_PATH as null when empty string', () => {
      const config = loadConfig(validEnv({ CSV_OUTPUT_PATH: '' }));
      expect(config.csvOutputPath).toBeNull();
    });

    it('should parse CSV_OUTPUT_PATH as null when whitespace only', () => {
      const config = loadConfig(validEnv({ CSV_OUTPUT_PATH: '   ' }));
      expect(config.csvOutputPath).toBeNull();
    });

    it('should parse CSV_OUTPUT_PATH when set to a valid path', () => {
      const config = loadConfig(validEnv({ CSV_OUTPUT_PATH: '/tmp/output.csv' }));
      expect(config.csvOutputPath).toBe('/tmp/output.csv');
    });

    it('should parse REMOVED_PROTECTION_THRESHOLD with default 0.30', () => {
      const config = loadConfig(validEnv());
      expect(config.removedProtectionThreshold).toBe(0.30);
    });

    it('should parse custom REMOVED_PROTECTION_THRESHOLD', () => {
      const config = loadConfig(validEnv({ REMOVED_PROTECTION_THRESHOLD: '0.50' }));
      expect(config.removedProtectionThreshold).toBe(0.50);
    });

    it('should reject invalid REMOVED_PROTECTION_THRESHOLD', () => {
      const env = validEnv({ REMOVED_PROTECTION_THRESHOLD: 'abc' });
      expect(() => loadConfig(env)).toThrow('process.exit called');
    });

    it('should parse DRY_RUN=true', () => {
      const config = loadConfig(validEnv({ DRY_RUN: 'true' }));
      expect(config.dryRun).toBe(true);
    });

    it('should parse DRY_RUN=false (default)', () => {
      const config = loadConfig(validEnv());
      expect(config.dryRun).toBe(false);
    });

    it('should parse FORCE_SYNC=true', () => {
      const config = loadConfig(validEnv({ FORCE_SYNC: 'true' }));
      expect(config.forceSync).toBe(true);
    });

    it('should parse FORCE_SYNC=false (default)', () => {
      const config = loadConfig(validEnv());
      expect(config.forceSync).toBe(false);
    });
  });

  describe('repoRoot resolution', () => {
    it('should use CI_PROJECT_DIR in ci mode', () => {
      const config = loadConfig(validEnv({
        CI: 'true',
        CI_PROJECT_DIR: '/builds/my-project',
      }));
      expect(config.repoRoot).toBe('/builds/my-project');
    });

    it('should use REPO_ROOT in local-cli mode', () => {
      const config = loadConfig(validEnv({
        REPO_ROOT: '/home/user/my-repo',
      }));
      expect(config.repoRoot).toBe('/home/user/my-repo');
    });

    it('should fall back to process.cwd() in local-cli mode when REPO_ROOT not set', () => {
      const config = loadConfig(validEnv());
      expect(config.repoRoot).toBe(process.cwd());
    });
  });

  describe('CI context fields', () => {
    it('should extract pipelineId and jobId from CI vars', () => {
      const config = loadConfig(validEnv({
        CI: 'true',
        CI_PROJECT_DIR: '/builds/project',
        CI_PIPELINE_ID: '12345',
        CI_JOB_ID: '67890',
      }));
      expect(config.pipelineId).toBe('12345');
      expect(config.jobId).toBe('67890');
    });

    it('should default pipelineId and jobId to empty string in local-cli mode', () => {
      const config = loadConfig(validEnv());
      expect(config.pipelineId).toBe('');
      expect(config.jobId).toBe('');
    });

    it('should use CI_PROJECT_PATH for projectPath', () => {
      const config = loadConfig(validEnv({
        CI: 'true',
        CI_PROJECT_DIR: '/builds/project',
        CI_PROJECT_PATH: 'group/my-project',
      }));
      expect(config.projectPath).toBe('group/my-project');
    });

    it('should use CI_COMMIT_SHA for commitSha', () => {
      const config = loadConfig(validEnv({
        CI: 'true',
        CI_PROJECT_DIR: '/builds/project',
        CI_COMMIT_SHA: 'abc123def456',
      }));
      expect(config.commitSha).toBe('abc123def456');
    });
  });

  describe('Object.freeze', () => {
    it('should return a frozen config object', () => {
      const config = loadConfig(validEnv());
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('should not allow modification of config properties', () => {
      const config = loadConfig(validEnv());
      expect(() => {
        (config as unknown as Record<string, unknown>).dryRun = true;
      }).toThrow();
    });
  });
});
