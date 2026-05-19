import fs from 'node:fs';
import path from 'node:path';
import type { ScanResult, IgnoredEntry } from './types.js';

/**
 * Scans the specs directory for valid spec directories.
 * Default path: `<repoRoot>/.kiro/specs`, configurable via specsPath parameter.
 */
export function scanSpecs(repoRoot: string, specsRelativePath = '.kiro/specs'): ScanResult {
  const specsDir = path.join(repoRoot, specsRelativePath);

  if (!fs.existsSync(specsDir)) {
    return { specs: [], ignored: [] };
  }

  const specs: Array<{ specId: string; path: string | null }> = [];
  const ignored: IgnoredEntry[] = [];

  const entries = fs.readdirSync(specsDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(specsDir, entry.name);

    // Dot-prefixed entries (files or directories)
    if (entry.name.startsWith('.')) {
      ignored.push({ name: entry.name, reason: 'dot_prefix', path: entryPath });
      continue;
    }

    // Underscore-prefixed entries (files or directories)
    if (entry.name.startsWith('_')) {
      ignored.push({ name: entry.name, reason: 'underscore_prefix', path: entryPath });
      continue;
    }

    // Stray files (not directories)
    if (!entry.isDirectory()) {
      ignored.push({ name: entry.name, reason: 'stray_file', path: entryPath });
      continue;
    }

    // Directory: check for tasks.md
    const tasksFilePath = path.join(entryPath, 'tasks.md');

    if (fs.existsSync(tasksFilePath) && fs.statSync(tasksFilePath).isFile()) {
      specs.push({ specId: entry.name, path: tasksFilePath });
    } else {
      // Directory exists but no tasks.md → no_tasks_file
      console.warn(
        `[WARN] Spec directory "${entry.name}" has no tasks.md — skipping (${entryPath})`
      );
      ignored.push({ name: entry.name, reason: 'no_tasks_file', path: entryPath });
    }
  }

  // Sort specs by specId lexicographically for determinism
  specs.sort((a, b) => a.specId.localeCompare(b.specId));

  return { specs, ignored };
}
