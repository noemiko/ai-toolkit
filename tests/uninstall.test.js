'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BEGIN, END } = require('../install.js');
const { uninstall } = require('../uninstall.js');
const {
  SKILL_FILE, BUNDLED_SKILL, MANIFEST_FILE, createFixture, writeFile,
  readBytes, readText, readJson, exists, removeFile, snapshotFiles,
} = require('./helpers');

describe('uninstall: removing only owned content', () => {
  it('removes unchanged managed content while keeping unrelated files and rules', (t) => {
    const { consumerRoot, install } = createFixture(t);
    writeFile(consumerRoot, 'AGENTS.md', 'Original rules\n');
    install();
    writeFile(consumerRoot, '.agents/skills/code-review/custom.txt', 'unrelated');

    const result = uninstall(consumerRoot);

    assert.deepEqual(result.preserved, []);
    assert.equal(exists(consumerRoot, SKILL_FILE), false);
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
    assert.equal(readText(consumerRoot, '.agents/skills/code-review/custom.txt'), 'unrelated');
    assert.equal(readText(consumerRoot, 'AGENTS.md'), 'Original rules\n\n');
  });

  it('prunes an empty managed skill directory but leaves AGENTS.md in place', (t) => {
    const { consumerRoot, install } = createFixture(t);
    install();

    uninstall(consumerRoot);

    assert.equal(exists(consumerRoot, '.agents/skills/code-review'), false);
    assert.equal(exists(consumerRoot, 'AGENTS.md'), true);
    assert.equal(readText(consumerRoot, 'AGENTS.md'), '\n');
  });

  it('a repeated completed uninstall is a successful no-op', (t) => {
    const { consumerRoot, install } = createFixture(t);
    install();
    uninstall(consumerRoot);
    const before = snapshotFiles(consumerRoot);

    assert.deepEqual(uninstall(consumerRoot).preserved, []);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('does not guess ownership when the manifest is absent', (t) => {
    const { consumerRoot } = createFixture(t);
    writeFile(consumerRoot, SKILL_FILE, 'untracked skill');
    const before = snapshotFiles(consumerRoot);

    assert.deepEqual(uninstall(consumerRoot).preserved, []);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('keeps edited skills and rules, tracking only unresolved content', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    writeFile(packageRoot, 'rules/AGENTS.md', 'Delivered rule\n');
    writeFile(packageRoot, 'skills/code-review/extra.txt', 'unchanged');
    install();
    writeFile(consumerRoot, SKILL_FILE, 'Local skill');
    const localRules = `${BEGIN}\nLocal rule\n${END}\n`;
    writeFile(consumerRoot, 'AGENTS.md', localRules);

    const result = uninstall(consumerRoot);

    assert.deepEqual([...result.preserved].sort(), [SKILL_FILE, 'AGENTS.md'].sort());
    assert.equal(readText(consumerRoot, SKILL_FILE), 'Local skill');
    assert.equal(readText(consumerRoot, 'AGENTS.md'), localRules);
    assert.deepEqual(Object.keys(readJson(consumerRoot, MANIFEST_FILE).files), [SKILL_FILE]);
    assert.ok(readJson(consumerRoot, MANIFEST_FILE).rules);
    assert.equal(exists(consumerRoot, '.agents/skills/code-review/extra.txt'), false);
  });

  it('finishes cleanup after locally edited content is restored', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    writeFile(packageRoot, 'rules/AGENTS.md', 'Delivered rule\n');
    install();
    const deliveredRules = readBytes(consumerRoot, 'AGENTS.md');
    writeFile(consumerRoot, SKILL_FILE, 'Local skill');
    writeFile(consumerRoot, 'AGENTS.md', `${BEGIN}\nLocal rule\n${END}\n`);
    uninstall(consumerRoot);
    writeFile(consumerRoot, SKILL_FILE, readBytes(packageRoot, BUNDLED_SKILL));
    writeFile(consumerRoot, 'AGENTS.md', deliveredRules);

    const result = uninstall(consumerRoot);

    assert.deepEqual(result.preserved, []);
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
    assert.equal(exists(consumerRoot, SKILL_FILE), false);
  });

  it('retains malformed managed rules for manual resolution', (t) => {
    const { consumerRoot, install } = createFixture(t);
    install();
    writeFile(consumerRoot, 'AGENTS.md', BEGIN);

    const result = uninstall(consumerRoot);

    assert.deepEqual(result.preserved, ['AGENTS.md']);
    assert.equal(readText(consumerRoot, 'AGENTS.md'), BEGIN);
    assert.deepEqual(readJson(consumerRoot, MANIFEST_FILE).files, {});
    assert.ok(readJson(consumerRoot, MANIFEST_FILE).rules);
  });

  it('treats missing tracked skills and rules as already removed', (t) => {
    const { consumerRoot, install } = createFixture(t);
    install();
    removeFile(consumerRoot, SKILL_FILE);
    removeFile(consumerRoot, 'AGENTS.md');

    assert.deepEqual(uninstall(consumerRoot).preserved, []);

    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
  });
});
