#!/usr/bin/env node
import { isDirectExecution, packLevel, parseArgs } from './lib.mjs';

export { packLevel } from './lib.mjs';

async function main() {
  const args = parseArgs();
  if (!args.dir || args.help) {
    console.log('用法：node pack.mjs --dir ./my-level [--out ./dist]');
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  const result = await packLevel(String(args.dir), args.out ? String(args.out) : undefined);
  console.log(JSON.stringify({
    ok: true,
    output: result.outputPath,
    levelId: result.levelId,
    contentHash: result.contentHash,
    packageHash: result.packageHash,
    bytes: result.bytes,
    warnings: result.validation.warnings,
  }, null, 2));
}

if (isDirectExecution(import.meta.url)) {
  main().catch((caught) => {
    console.error(`打包失败：\n${caught.message}`);
    process.exitCode = 1;
  });
}
