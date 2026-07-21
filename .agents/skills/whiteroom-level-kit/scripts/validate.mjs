#!/usr/bin/env node
import path from 'node:path';
import { formatValidation, isDirectExecution, parseArgs, validateLevel } from './lib.mjs';

export async function runValidation(levelDir, options = {}) {
  return validateLevel(path.resolve(levelDir), options);
}

async function main() {
  const args = parseArgs();
  if (!args.dir || args.help) {
    console.log('用法：node validate.mjs --dir ./my-level [--json]');
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  const result = await runValidation(String(args.dir));
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatValidation(result));
  if (!result.valid) process.exitCode = 1;
}

if (isDirectExecution(import.meta.url)) {
  main().catch((caught) => {
    console.error(`校验失败：${caught.message}`);
    process.exitCode = 1;
  });
}
