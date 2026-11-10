'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SOURCE_ROOT, PACKAGE_NAME, SKILL_FILE, MANIFEST_FILE, npm,
  createFixture, readBytes, readText, readJson, writeFile, exists,
  snapshotFiles, runCommand, assertCommandSucceeded, runBin, packSource,
} = require('./helpers');

describe('package: public npm contract', () => {
  it('declares a scoped identity, registry, supported runtime and both command names', () => {
    const metadata = readJson(SOURCE_ROOT, 'package.json');

    assert.match(metadata.name, /^@[a-z0-9][a-z0-9._-]*\/ai-toolkit$/);
    assert.equal(metadata.license, 'UNLICENSED');
    assert.equal(metadata.engines.node, '>=22');
    assert.equal(metadata.publishConfig.registry, 'https://npm.pkg.github.com');
    assert.deepEqual(Object.keys(metadata.bin).sort(), ['ai-toolkit', 'ai-toolkit-uninstall']);
  });

  it('both entry scripts have Node shebangs and executable permissions', () => {
    for (const file of ['install.js', 'uninstall.js']) {
      assert.match(readText(SOURCE_ROOT, file), /^#!\/usr\/bin\/env node/, file);
      if (process.platform !== 'win32') {
        assert.ok(fs.statSync(path.join(SOURCE_ROOT, file)).mode & 0o111, `${file} must be executable`);
      }
    }
  });

  it('the actual source tarball excludes tests and development files', { timeout: 120000 }, (t) => {
    const { temporaryRoot } = createFixture(t);

    const packed = packSource(temporaryRoot);

    assert.deepEqual(packed.files, [
      'README.md', 'install.js', 'package.json', 'rules/AGENTS.md',
      'skills/code-review/SKILL.md', 'uninstall.js',
    ].sort());
  });
});

describe('package install: real npm consumer workflows', () => {
  it('tarball postinstall delivers artifacts and both installed bin commands work', { timeout: 120000 }, (t) => {
    const { temporaryRoot, consumerRoot } = createFixture(t);
    const { archivePath } = packSource(temporaryRoot);

    assertCommandSucceeded(runCommand(npm, [
      'install', archivePath, '--no-audit', '--no-fund', '--foreground-scripts',
    ], consumerRoot));

    assert.deepEqual(readBytes(consumerRoot, SKILL_FILE), readBytes(SOURCE_ROOT, 'skills/code-review/SKILL.md'));
    assert.equal(readJson(consumerRoot, MANIFEST_FILE).package, PACKAGE_NAME);
    assertCommandSucceeded(runBin(consumerRoot, 'ai-toolkit-uninstall'));
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
    assert.equal(exists(consumerRoot, SKILL_FILE), false);

    assertCommandSucceeded(runBin(consumerRoot, 'ai-toolkit'));
    assert.equal(exists(consumerRoot, MANIFEST_FILE), true);
    assert.equal(exists(consumerRoot, SKILL_FILE), true);
  });

  it('manual installation works after npm ci disables lifecycle scripts', { timeout: 120000 }, (t) => {
    const { temporaryRoot, consumerRoot } = createFixture(t);
    const { archivePath } = packSource(temporaryRoot);
    // Create the lockfile without running setup, then exercise the documented CI path.
    assertCommandSucceeded(runCommand(npm, [
      'install', archivePath, '--ignore-scripts', '--no-audit', '--no-fund',
    ], consumerRoot));

    assertCommandSucceeded(runCommand(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], consumerRoot));
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
    assert.equal(exists(consumerRoot, SKILL_FILE), false);

    assertCommandSucceeded(runBin(consumerRoot, 'ai-toolkit'));
    assert.equal(exists(consumerRoot, MANIFEST_FILE), true);
    assert.equal(exists(consumerRoot, SKILL_FILE), true);
  });

  it('npm --prefix installs in the target and leaves the calling project unchanged', { timeout: 120000 }, (t) => {
    const { temporaryRoot, consumerRoot: callerRoot } = createFixture(t);
    const targetRoot = path.join(temporaryRoot, 'target');
    writeFile(targetRoot, 'package.json', '{"name":"target","version":"1.0.0","private":true}');
    writeFile(callerRoot, 'AGENTS.md', 'Caller rules must remain untouched\n');
    const callerBefore = snapshotFiles(callerRoot);
    const { archivePath } = packSource(temporaryRoot);

    assertCommandSucceeded(runCommand(npm, [
      '--prefix', targetRoot, 'install', archivePath, '--no-audit', '--no-fund', '--foreground-scripts',
    ], callerRoot));

    assert.equal(exists(targetRoot, MANIFEST_FILE), true, 'Target must receive the ownership manifest');
    assert.equal(exists(targetRoot, SKILL_FILE), true, 'Target must receive the skill');
    assert.ok(readText(targetRoot, 'AGENTS.md').includes(`<!-- BEGIN ${PACKAGE_NAME} -->`));
    assert.deepEqual(snapshotFiles(callerRoot), callerBefore);
  });
});
