import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanSpecs } from '@/scanner.js';

describe('scanSpecs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scanner-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSpecsDir(): string {
    const specsDir = path.join(tmpDir, '.kiro', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    return specsDir;
  }

  it('returns empty result when .kiro/specs does not exist', () => {
    const result = scanSpecs(tmpDir);
    expect(result).toEqual({ specs: [], ignored: [] });
  });

  it('collects valid specs with tasks.md', () => {
    const specsDir = makeSpecsDir();
    const specDir = path.join(specsDir, 'user-auth');
    fs.mkdirSync(specDir);
    fs.writeFileSync(path.join(specDir, 'tasks.md'), '# Tasks');

    const result = scanSpecs(tmpDir);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0].specId).toBe('user-auth');
    expect(result.specs[0].path).toBe(path.join(specDir, 'tasks.md'));
    expect(result.ignored).toHaveLength(0);
  });

  it('ignores stray files', () => {
    const specsDir = makeSpecsDir();
    fs.writeFileSync(path.join(specsDir, 'README.md'), '# Readme');
    fs.writeFileSync(path.join(specsDir, 'notes.txt'), 'notes');

    const result = scanSpecs(tmpDir);
    expect(result.specs).toHaveLength(0);
    expect(result.ignored).toHaveLength(2);
    expect(result.ignored.map(i => i.reason)).toEqual(['stray_file', 'stray_file']);
  });

  it('ignores dot-prefixed entries', () => {
    const specsDir = makeSpecsDir();
    fs.mkdirSync(path.join(specsDir, '.cache'));
    fs.writeFileSync(path.join(specsDir, '.DS_Store'), '');

    const result = scanSpecs(tmpDir);
    expect(result.specs).toHaveLength(0);
    expect(result.ignored).toHaveLength(2);
    expect(result.ignored.every(i => i.reason === 'dot_prefix')).toBe(true);
  });

  it('ignores underscore-prefixed directories', () => {
    const specsDir = makeSpecsDir();
    fs.mkdirSync(path.join(specsDir, '_legacy'));
    fs.mkdirSync(path.join(specsDir, '_archive'));

    const result = scanSpecs(tmpDir);
    expect(result.specs).toHaveLength(0);
    expect(result.ignored).toHaveLength(2);
    expect(result.ignored.every(i => i.reason === 'underscore_prefix')).toBe(true);
  });

  it('ignores directories without tasks.md (no_tasks_file)', () => {
    const specsDir = makeSpecsDir();
    const specDir = path.join(specsDir, 'project-scope');
    fs.mkdirSync(specDir);
    fs.writeFileSync(path.join(specDir, 'requirements.md'), '# Req');

    const result = scanSpecs(tmpDir);
    expect(result.specs).toHaveLength(0);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0]).toEqual({
      name: 'project-scope',
      reason: 'no_tasks_file',
      path: specDir,
    });
  });

  it('sorts specs by specId lexicographically', () => {
    const specsDir = makeSpecsDir();
    for (const name of ['zebra', 'alpha', 'middle']) {
      const dir = path.join(specsDir, name);
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'tasks.md'), '# Tasks');
    }

    const result = scanSpecs(tmpDir);
    expect(result.specs.map(s => s.specId)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('handles mixed entries correctly', () => {
    const specsDir = makeSpecsDir();

    // Valid spec
    const validDir = path.join(specsDir, 'user-auth');
    fs.mkdirSync(validDir);
    fs.writeFileSync(path.join(validDir, 'tasks.md'), '# Tasks');

    // Stray file
    fs.writeFileSync(path.join(specsDir, 'README.md'), '# Readme');

    // Dot prefix
    fs.writeFileSync(path.join(specsDir, '.DS_Store'), '');

    // Underscore prefix
    fs.mkdirSync(path.join(specsDir, '_legacy'));

    // No tasks.md
    const noTasksDir = path.join(specsDir, 'project-scope');
    fs.mkdirSync(noTasksDir);
    fs.writeFileSync(path.join(noTasksDir, 'requirements.md'), '# Req');

    const result = scanSpecs(tmpDir);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0].specId).toBe('user-auth');
    expect(result.ignored).toHaveLength(4);

    const reasons = result.ignored.map(i => i.reason).sort();
    expect(reasons).toEqual(['dot_prefix', 'no_tasks_file', 'stray_file', 'underscore_prefix']);
  });
});
