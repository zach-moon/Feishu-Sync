/**
 * Entry point for the Feishu sync script.
 * Can be invoked via:
 *   - Local CLI: `npx tsx src/sync-to-feishu.ts`
 *   - CI: `node dist/sync-to-feishu.js`
 */
import { loadConfig } from './config.js';
import { runSync } from './sync.js';
import { redactError } from './reporter.js';

async function main(): Promise<number> {
  try {
    const config = loadConfig(process.env);
    return await runSync(config);
  } catch (err: unknown) {
    process.stderr.write(`[feisync] Uncaught error: ${redactError(err)}\n`);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
