'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { uninstall } = require('../uninstall.js');
const {
  SKILL_FILE, MANIFEST_FILE, createFixture, writeFile, readText, exists,
  snapshotFiles, runCommand, installDependencyCopy,
} = require('./helpers');

function failAtManifest(operation) {
  if (operation.file === MANIFEST_FILE) throw new Error('Injected manifest failure');
}

describe('failure: rollback and concurrent edits', () => {
  it('restores existing file contents when installation fails before saving its manifest', (t) => {
    const { consumerRoot, install } = createFixture(t);
    writeFile(consumerRoot, 'AGENTS.md', 'Existing rules\n');
    const before = snapshotFiles(consumerRoot);

    assert.throws(() => install({ beforeApply: failAtManifest }), /were restored/);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('restores removed files when uninstall fails before removing its manifest', (t) => {
    const { consumerRoot, install } = createFixture(t);
    install();
    const before = snapshotFiles(consumerRoot);

    assert.throws(() => uninstall(consumerRoot, { beforeApply: failAtManifest }), /were restored/);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('preserves a subsequent edit instead of overwriting it during rollback', (t) => {
    const { consumerRoot, install } = createFixture(t);
    function editSkillThenFail(operation) {
      if (operation.file === 'AGENTS.md') {
        writeFile(consumerRoot, SKILL_FILE, 'Concurrent edit');
        throw new Error('Injected failure');
      }
    }

    assert.throws(() => install({ beforeApply: editSkillThenFail }), /Recovery incomplete.*SKILL.md/);

    assert.equal(readText(consumerRoot, SKILL_FILE), 'Concurrent edit');
  });

  it('restores file contents and cleans temporary files after a filesystem publication error', (t) => {
    const { consumerRoot, install } = createFixture(t);
    writeFile(consumerRoot, 'AGENTS.md', 'Original rules');
    const before = snapshotFiles(consumerRoot);
    const originalLink = fs.linkSync;
    // This exercises a real publication boundary, unlike beforeApply failures.
    t.mock.method(fs, 'linkSync', (from, to) => {
      if (to === path.join(consumerRoot, MANIFEST_FILE)) {
        throw Object.assign(new Error('Filesystem permission denied'), { code: 'EACCES' });
      }
      return originalLink(from, to);
    });

    assert.throws(() => install(), /Filesystem permission denied.*were restored/);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('refuses to delete a skill edited after uninstall preflight', (t) => {
    const { consumerRoot, install } = createFixture(t);
    install();
    function editBeforeDeletion(operation) {
      if (operation.file === SKILL_FILE) writeFile(consumerRoot, SKILL_FILE, 'New local edit');
    }

    assert.throws(() => uninstall(consumerRoot, { beforeApply: editBeforeDeletion }), /File changed/);

    assert.equal(readText(consumerRoot, SKILL_FILE), 'New local edit');
    assert.equal(exists(consumerRoot, MANIFEST_FILE), true);
  });
});

describe('failure: command-line exit contracts', () => {
  it('manual installation returns nonzero and identifies a conflicting file', (t) => {
    const { consumerRoot, packageRoot } = createFixture(t);
    writeFile(consumerRoot, SKILL_FILE, 'Local skill');

    const result = runCommand(process.execPath, [path.join(packageRoot, 'install.js')], consumerRoot);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Conflicting skill file/);
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
  });

  it('dependency postinstall warns on conflict and exits successfully', (t) => {
    const { consumerRoot, packageRoot } = createFixture(t);
    writeFile(consumerRoot, SKILL_FILE, 'Local skill');
    const installedRoot = installDependencyCopy(consumerRoot, packageRoot);

    const result = runCommand(process.execPath, [path.join(installedRoot, 'install.js')], installedRoot, {
      INIT_CWD: consumerRoot, npm_lifecycle_event: 'postinstall',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /not fully installed/);
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
  });

  for (const caller of ['source directory', 'another project']) {
    it(`source postinstall is a no-op when called from ${caller}`, (t) => {
      const { consumerRoot, packageRoot } = createFixture(t);
      const consumerBefore = snapshotFiles(consumerRoot);
      const packageBefore = snapshotFiles(packageRoot);

      const result = runCommand(process.execPath, [path.join(packageRoot, 'install.js')], packageRoot, {
        INIT_CWD: caller === 'source directory' ? packageRoot : consumerRoot,
        npm_lifecycle_event: 'postinstall',
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /skipped/);
      assert.deepEqual(snapshotFiles(consumerRoot), consumerBefore);
      assert.deepEqual(snapshotFiles(packageRoot), packageBefore);
    });
  }

  it('manual uninstall returns nonzero and preserves a locally edited skill', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    install();
    writeFile(consumerRoot, SKILL_FILE, 'Local edit');

    const result = runCommand(process.execPath, [path.join(packageRoot, 'uninstall.js')], consumerRoot);

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /preserved local edits/);
    assert.equal(readText(consumerRoot, SKILL_FILE), 'Local edit');
  });
});
