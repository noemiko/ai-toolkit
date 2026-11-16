'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { BEGIN } = require('../install.js');
const {
  SKILL_FILE, BUNDLED_SKILL, MANIFEST_FILE, createFixture, writeFile,
  removeFile, readJson, assertReadOnlyCommand,
} = require('./helpers');

describe('install: read-only dry run and check', () => {
  it('dry run previews a first installation without creating files or directories', (t) => {
    const fixture = createFixture(t);

    const result = assertReadOnlyCommand(fixture, ['--dry-run']);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`would create: ${SKILL_FILE}`));
    assert.ok(result.stdout.includes(`would create: ${MANIFEST_FILE}`));
    assert.match(result.stdout, /would create: AGENTS.md/);
  });

  it('check returns nonzero when the toolkit has not been installed', (t) => {
    const result = assertReadOnlyCommand(createFixture(t), ['--check']);

    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(`needs create: ${MANIFEST_FILE}`));
  });

  for (const flag of ['--dry-run', '--check']) {
    it(`${flag} succeeds for a current installation with unrelated consumer content`, (t) => {
      const fixture = createFixture(t);
      writeFile(fixture.consumerRoot, 'AGENTS.md', 'Consumer rules\n');
      fixture.install();
      writeFile(fixture.consumerRoot, '.agents/skills/code-review/user.txt', 'User file');

      const result = assertReadOnlyCommand(fixture, [flag]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /up to date/);
    });
  }

  it('dry run previews an update that the normal installer subsequently applies', (t) => {
    const fixture = createFixture(t);
    fixture.install();
    writeFile(fixture.packageRoot, BUNDLED_SKILL, 'New upstream skill\n');

    const preview = assertReadOnlyCommand(fixture, ['--dry-run']);

    assert.equal(preview.status, 0, preview.stderr);
    assert.ok(preview.stdout.includes(`would update: ${SKILL_FILE}`));
    assert.equal(assertReadOnlyCommand(fixture, ['--check']).status, 1);
    fixture.install();
    assert.equal(assertReadOnlyCommand(fixture, ['--check']).status, 0);
  });

  it('check detects a stale manifest version even when artifact contents match', (t) => {
    const fixture = createFixture(t);
    fixture.install();
    const metadata = readJson(fixture.packageRoot, 'package.json');
    metadata.version = '9.8.7';
    writeFile(fixture.packageRoot, 'package.json', JSON.stringify(metadata));

    const result = assertReadOnlyCommand(fixture, ['--check']);

    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(`needs update: ${MANIFEST_FILE}`));
  });

  it('check identifies a missing tracked skill without restoring it', (t) => {
    const fixture = createFixture(t);
    fixture.install();
    removeFile(fixture.consumerRoot, SKILL_FILE);

    const result = assertReadOnlyCommand(fixture, ['--check']);

    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(`needs create: ${SKILL_FILE}`));
  });

  it('dry run lists obsolete managed files that would be removed', (t) => {
    const fixture = createFixture(t);
    writeFile(fixture.packageRoot, 'skills/code-review/old.txt', 'Old file');
    fixture.install();
    removeFile(fixture.packageRoot, 'skills/code-review/old.txt');

    const result = assertReadOnlyCommand(fixture, ['--dry-run']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /would remove: .agents\/skills\/code-review\/old.txt/);
  });

  const blockedCases = [
    { name: 'locally edited skill', message: /Conflicting skill file/, change: (fixture) => writeFile(fixture.consumerRoot, SKILL_FILE, 'My edit') },
    { name: 'malformed rules markers', message: /Malformed toolkit markers/, change: (fixture) => writeFile(fixture.consumerRoot, 'AGENTS.md', BEGIN) },
    { name: 'invalid manifest', message: /Invalid JSON/, change: (fixture) => writeFile(fixture.consumerRoot, MANIFEST_FILE, '{invalid') },
  ];
  for (const { name, message, change } of blockedCases) {
    for (const flag of ['--dry-run', '--check']) {
      it(`${flag} reports ${name} without changing files`, (t) => {
        const fixture = createFixture(t);
        fixture.install();
        change(fixture);

        const result = assertReadOnlyCommand(fixture, [flag]);

        assert.equal(result.status, 1);
        assert.match(result.stderr, message);
      });
    }
  }

  for (const flag of ['--unknown', '--dry-run', '--check']) {
    it(`uninstall rejects unsupported ${flag} without removing anything`, (t) => {
      const fixture = createFixture(t);
      fixture.install();

      const result = assertReadOnlyCommand(fixture, [flag], 'uninstall.js');

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Usage:/);
    });
  }

  it('rejects combining --dry-run and --check without changing the consumer', (t) => {
    const fixture = createFixture(t);

    const result = assertReadOnlyCommand(fixture, ['--dry-run', '--check']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  });
});
