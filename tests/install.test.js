'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { BEGIN, END } = require('../install.js');
const { uninstall } = require('../uninstall.js');
const {
  PACKAGE_NAME, SKILL_FILE, BUNDLED_SKILL, MANIFEST_FILE,
  createFixture, writeFile, readBytes, readText, readJson, removeFile, exists, snapshotFiles,
} = require('./helpers');

// Suite names retain the install/uninstall/package/failure phase-gate filters.
describe('install: skills and ownership', () => {
  it('copies the bundled skill and records the delivered version and hashes', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    const metadata = readJson(packageRoot, 'package.json');
    metadata.version = '7.8.9';
    writeFile(packageRoot, 'package.json', JSON.stringify(metadata));

    install();

    assert.deepEqual(readBytes(consumerRoot, SKILL_FILE), readBytes(packageRoot, BUNDLED_SKILL));
    const manifest = readJson(consumerRoot, MANIFEST_FILE);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.package, PACKAGE_NAME);
    assert.equal(manifest.version, '7.8.9', 'Version must come from the distributed metadata, not a constant');
    const expectedSkillHash = createHash('sha256').update(readBytes(packageRoot, BUNDLED_SKILL)).digest('hex');
    assert.deepEqual(manifest.files, { [SKILL_FILE]: expectedSkillHash });
    const rulesBlock = `${BEGIN}\n${readText(packageRoot, 'rules/AGENTS.md').trimEnd()}\n${END}`;
    assert.deepEqual(manifest.rules, {
      path: 'AGENTS.md', begin: BEGIN, end: END,
      sha256: createHash('sha256').update(rulesBlock).digest('hex'),
    });
  });

  it('repeating an unchanged installation leaves every file byte-identical', (t) => {
    const { consumerRoot, install } = createFixture(t);
    install();
    const before = snapshotFiles(consumerRoot);

    install();

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('updates an unchanged tracked skill and records the new package version', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    install();
    writeFile(packageRoot, BUNDLED_SKILL, 'Updated upstream skill\n');
    const metadata = readJson(packageRoot, 'package.json');
    metadata.version = '9.0.0';
    writeFile(packageRoot, 'package.json', JSON.stringify(metadata));

    install();

    assert.equal(readText(consumerRoot, SKILL_FILE), 'Updated upstream skill\n');
    assert.equal(readJson(consumerRoot, MANIFEST_FILE).version, '9.0.0');
  });

  it('recreates a missing tracked skill', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    install();
    removeFile(consumerRoot, SKILL_FILE);

    install();

    assert.deepEqual(readBytes(consumerRoot, SKILL_FILE), readBytes(packageRoot, BUNDLED_SKILL));
  });

  for (const content of ['identical to the bundle', 'different from the bundle']) {
    it(`refuses an untracked skill ${content} without changing existing files`, (t) => {
      const { consumerRoot, packageRoot, install } = createFixture(t);
      writeFile(consumerRoot, SKILL_FILE, content === 'identical to the bundle' ? readBytes(packageRoot, BUNDLED_SKILL) : 'local');
      const before = snapshotFiles(consumerRoot);

      assert.throws(() => install(), /Conflicting skill file/);

      assert.deepEqual(snapshotFiles(consumerRoot), before);
    });
  }

  it('protects a locally edited skill even when the next bundle contains the same edits', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    install();
    writeFile(consumerRoot, SKILL_FILE, 'local changes');
    writeFile(packageRoot, BUNDLED_SKILL, 'local changes');
    const before = snapshotFiles(consumerRoot);

    assert.throws(() => install(), /Conflicting skill file/);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('removes an obsolete unchanged skill file while retaining unrelated files', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    writeFile(packageRoot, 'skills/code-review/old.txt', 'obsolete');
    install();
    writeFile(consumerRoot, '.agents/skills/code-review/user.txt', 'unrelated');
    removeFile(packageRoot, 'skills/code-review/old.txt');

    install();

    assert.equal(exists(consumerRoot, '.agents/skills/code-review/old.txt'), false);
    assert.equal(readText(consumerRoot, '.agents/skills/code-review/user.txt'), 'unrelated');
    assert.equal(Object.hasOwn(readJson(consumerRoot, MANIFEST_FILE).files, '.agents/skills/code-review/old.txt'), false);
  });

  it('stops an update rather than deleting an obsolete file edited by the consumer', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    writeFile(packageRoot, 'skills/code-review/old.txt', 'obsolete');
    install();
    writeFile(consumerRoot, '.agents/skills/code-review/old.txt', 'local edit');
    removeFile(packageRoot, 'skills/code-review/old.txt');
    const before = snapshotFiles(consumerRoot);

    assert.throws(() => install(), /Conflicting skill file/);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });
});

describe('install: managed rules', () => {
  const malformedMarkers = [
    { name: 'missing closing marker', contents: BEGIN },
    { name: 'missing opening marker', contents: END },
    { name: 'closing marker before opening marker', contents: `${END}\n${BEGIN}` },
    { name: 'two managed blocks', contents: `${BEGIN}\n${END}\n${BEGIN}\n${END}` },
  ];
  for (const { name, contents } of malformedMarkers) {
    it(`rejects ${name} without changing existing files`, (t) => {
      const { consumerRoot, install } = createFixture(t);
      writeFile(consumerRoot, 'AGENTS.md', contents);
      const before = snapshotFiles(consumerRoot);

      assert.throws(() => install(), /Malformed toolkit markers/);

      assert.deepEqual(snapshotFiles(consumerRoot), before);
    });
  }

  it('preserves outside bytes and CRLF line endings when updating the managed block', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    // Invalid UTF-8 proves preservation is byte-for-byte, rather than text decoding.
    const prefix = Buffer.from([0xff, 0x0d, 0x0a]);
    const suffix = Buffer.from('Outside suffix\r\n');
    writeFile(consumerRoot, 'AGENTS.md', prefix);
    install();
    writeFile(consumerRoot, 'AGENTS.md', Buffer.concat([readBytes(consumerRoot, 'AGENTS.md'), suffix]));
    writeFile(packageRoot, 'rules/AGENTS.md', 'New rule\nSecond rule\n');

    install();

    const expectedBlock = Buffer.from(`${BEGIN}\r\nNew rule\r\nSecond rule\r\n${END}\r\n`);
    assert.deepEqual(readBytes(consumerRoot, 'AGENTS.md'), Buffer.concat([prefix, expectedBlock, suffix]));
  });

  it('refuses edits inside a tracked rules block without changing existing files', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    writeFile(packageRoot, 'rules/AGENTS.md', 'Delivered rule\n');
    install();
    writeFile(consumerRoot, 'AGENTS.md', `${BEGIN}\nLocal rule\n${END}\n`);
    const before = snapshotFiles(consumerRoot);

    assert.throws(() => install(), /Conflicting managed rules/);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('refuses an untracked rules block even when it matches the bundle', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    writeFile(consumerRoot, 'AGENTS.md', `${BEGIN}\n${readText(packageRoot, 'rules/AGENTS.md').trimEnd()}\n${END}\n`);
    const before = snapshotFiles(consumerRoot);

    assert.throws(() => install(), /Conflicting managed rules/);

    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });
});

describe('install and uninstall: unsafe state', () => {
  const invalidManifests = [
    { name: 'invalid JSON', corrupt: () => '{bad' },
    { name: 'unsupported schema', corrupt: (manifest) => JSON.stringify({ ...manifest, schemaVersion: 99 }) },
    { name: 'a path escaping the skills directory', corrupt: (manifest) => {
      manifest.files['.agents/skills/../../victim'] = 'a'.repeat(64);
      return JSON.stringify(manifest);
    } },
  ];
  for (const { name, corrupt } of invalidManifests) {
    it(`refuses a manifest with ${name} without changing existing files`, (t) => {
      const { consumerRoot, install } = createFixture(t);
      install();
      writeFile(consumerRoot, MANIFEST_FILE, corrupt(readJson(consumerRoot, MANIFEST_FILE)));
      const before = snapshotFiles(consumerRoot);

      assert.throws(() => install(), /manifest/);
      assert.throws(() => uninstall(consumerRoot), /manifest/);

      assert.deepEqual(snapshotFiles(consumerRoot), before);
    });
  }

  it('does not follow a consumer .agents symlink outside the project', (t) => {
    const { temporaryRoot, consumerRoot, install } = createFixture(t);
    const outsideRoot = path.join(temporaryRoot, 'outside');
    fs.mkdirSync(outsideRoot);
    fs.symlinkSync(outsideRoot, path.join(consumerRoot, '.agents'), 'dir');
    const before = snapshotFiles(consumerRoot);

    assert.throws(() => install(), /Unsafe/);

    assert.deepEqual(fs.readdirSync(outsideRoot), []);
    assert.deepEqual(snapshotFiles(consumerRoot), before);
  });

  it('rejects a directory at AGENTS.md before installing any skill', (t) => {
    const { consumerRoot, install } = createFixture(t);
    fs.mkdirSync(path.join(consumerRoot, 'AGENTS.md'));

    assert.throws(() => install(), /Unsafe/);

    assert.equal(exists(consumerRoot, SKILL_FILE), false);
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
  });

  it('rejects a symlink in bundled skills before installing files', (t) => {
    const { consumerRoot, packageRoot, install } = createFixture(t);
    fs.symlinkSync(path.join(consumerRoot, 'package.json'), path.join(packageRoot, 'skills/code-review/link'));

    assert.throws(() => install(), /Unsafe bundled/);

    assert.equal(exists(consumerRoot, SKILL_FILE), false);
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
  });
});
