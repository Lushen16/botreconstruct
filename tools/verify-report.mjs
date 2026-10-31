#!/usr/bin/env node
// Verifica linhas CLAIM do relatorio contra arquivos reais.
// Uso: node tools/verify-report.mjs <report.md> <root>   (root default: ..)
// Formato: CLAIM <id> :: <caminho relativo ao root> :: <sha256|any> :: <nota>
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

const [reportPath, rootArg] = process.argv.slice(2);
if (!reportPath) {
  console.error('uso: node tools/verify-report.mjs <report.md> [root]');
  process.exit(2);
}
const root = resolve(rootArg || '..');
const md = await readFile(reportPath, 'utf8');
const pattern = /^CLAIM\s+(\S+)\s*::\s*(.+?)\s*::\s*([0-9a-f]{64}|any)\s*::\s*(.*)$/gm;
const claims = [...md.matchAll(pattern)].map(m => ({ id: m[1], path: m[2].trim(), expected: m[3], note: m[4].trim() }));
if (!claims.length) {
  console.error('nenhuma linha CLAIM encontrada em ' + reportPath);
  process.exit(2);
}

const verdicts = [];
for (const claim of claims) {
  const absolute = resolve(root, claim.path);
  const inside = absolute === root || absolute.startsWith(root + sep);
  let actual = null;
  let error = null;
  if (!inside) error = 'path-escape';
  else {
    try {
      const bytes = await readFile(absolute);
      actual = createHash('sha256').update(bytes).digest('hex');
    } catch (cause) { error = cause.code || cause.message; }
  }
  const pass = !error && (claim.expected === 'any' ? true : actual === claim.expected);
  verdicts.push({ ...claim, absolute, actual, pass, error });
}

const summary = { root, report: resolve(reportPath), total: verdicts.length,
  pass: verdicts.filter(v => v.pass).length, fail: verdicts.filter(v => !v.pass).length };
await writeFile('verify-report.json', JSON.stringify({ summary, verdicts }, null, 2) + '\n');
for (const v of verdicts) {
  const status = v.pass ? 'PASS' : v.error ? 'MISS ' + v.error : 'FAIL';
  console.log(status.padEnd(18) + ' ' + v.id.padEnd(26) + ' ' + (v.actual || '-').slice(0, 16) + '  ' + v.path);
}
console.log(`\n${summary.pass}/${summary.total} pass -> verify-report.json`);
process.exit(summary.fail ? 1 : 0);
