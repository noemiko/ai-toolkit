#!/usr/bin/env node
'use strict';

const { MANIFEST, hash, read, readManifest, readRules, guardRulesTarget, parseRules, apply, prune, run } = require('./install.js');

function uninstall(root, { beforeApply } = {}) {
  const { bytes, value: previous } = readManifest(root);
  if (!previous) return { preserved: [] };
  const operations = [];
  const files = Object.create(null);
  const preserved = [];
  for (const [file, baseline] of Object.entries(previous.files)) {
    const before = read(root, file);
    if (before === null) continue;
    if (hash(before) !== baseline) { files[file] = baseline; preserved.push(file); }
    else operations.push({ file, before, after: null });
  }
  let rules = null;
  let rulesFile;
  if (previous.rules) {
    const current = readRules(root, previous.rules);
    const before = current.bytes;
    rulesFile = current.file;
    let block;
    try { block = parseRules(before); }
    catch { preserved.push(rulesFile); rules = previous.rules; }
    if (block) {
      if (hash(block.bytes) !== previous.rules.sha256) { preserved.push(rulesFile); rules = previous.rules; }
      else operations.push({ file: rulesFile, before, after: Buffer.concat([before.subarray(0, block.start), before.subarray(block.end)]) });
    }
  }
  const remaining = { ...previous, files, rules };
  operations.push({ file: MANIFEST, before: bytes,
    after: preserved.length ? Buffer.from(`${JSON.stringify(remaining, null, 2)}\n`) : null });
  apply(root, operations, { beforeApply, validate: rulesFile ? () => guardRulesTarget(root, rulesFile) : undefined });
  try { prune(root, operations.filter((op) => op.file.startsWith('.agents/skills/')).map((op) => op.file)); }
  catch (error) { preserved.push(`empty directories (${error.message})`); }
  return { preserved };
}

module.exports = { uninstall };
if (require.main === module) run(uninstall);
