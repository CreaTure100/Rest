#!/usr/bin/env node
'use strict';

/**
 * Запуск тестов на встроенном node:test (Node >= 20).
 *   node scripts/run-tests.js unit [--watch] [--coverage]
 *   node scripts/run-tests.js integration
 *   node scripts/run-tests.js all
 *
 * Интеграционные файлы запускаются ПОСЛЕДОВАТЕЛЬНО: они используют одну тестовую БД.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const [, , suite = 'unit', ...flags] = process.argv;
const watch = flags.includes('--watch');
const coverage = flags.includes('--coverage');

function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collect(full);
      return /\.test\.(c|m)?js$/.test(entry.name) ? [full] : [];
    })
    .sort();
}

function run(files, extra = []) {
  if (files.length === 0) {
    console.error('Тестовые файлы не найдены');
    return 1;
  }
  const args = ['--test', '--test-reporter=spec', ...extra, ...files];
  return spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env }).status ?? 1;
}

function runUnit() {
  const extra = [];
  if (watch) extra.push('--watch');
  if (coverage) extra.push('--experimental-test-coverage');
  return run(collect(path.join(root, 'tests', 'unit')), extra);
}

function runIntegration() {
  let failed = 0;
  for (const file of collect(path.join(root, 'tests', 'integration'))) {
    console.log(`\n=== ${path.relative(root, file)} ===`);
    if (run([file]) !== 0) failed += 1;
  }
  return failed ? 1 : 0;
}

let code;
if (suite === 'unit') code = runUnit();
else if (suite === 'integration') code = runIntegration();
else if (suite === 'all') code = runUnit() || runIntegration();
else {
  console.error(`Неизвестный набор тестов: ${suite} (unit | integration | all)`);
  code = 2;
}
process.exit(code);
