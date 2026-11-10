#!/usr/bin/env node
'use strict';

const { MANIFEST, RULES, hash, read, readManifest, parseRules, apply, prune, run } = require('./install.js');

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
  if (previous.rules) {
    const before = read(root, RULES);
    let block;
    try { block = parseRules(before); }
    catch { preserved.push(RULES); rules = previous.rules; }
    if (block) {
      if (hash(block.bytes) !== previous.rules.sha256) { preserved.push(RULES); rules = previous.rules; }
      else operations.push({ file: RULES, before, after: Buffer.concat([before.subarray(0, block.start), before.subarray(block.end)]) });
    }
  }
  const remaining = { ...previous, files, rules };
  operations.push({ file: MANIFEST, before: bytes,
    after: preserved.length ? Buffer.from(`${JSON.stringify(remaining, null, 2)}\n`) : null });
  apply(root, operations, { beforeApply });
  try { prune(root, operations.filter((op) => op.file.startsWith('.agents/skills/')).map((op) => op.file)); }
  catch (error) { preserved.push(`empty directories (${error.message})`); }
  return { preserved };
}

module.exports = { uninstall };
if (require.main === module) run(uninstall);
