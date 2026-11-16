'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BEGIN, END } = require('../install.js');
const { uninstall } = require('../uninstall.js');
const {
  SKILL_FILE, MANIFEST_FILE, createFixture, writeFile, readBytes, readText,
  readJson, exists, snapshotFiles, assertReadOnlyCommand, removeFile,
} = require('./helpers');

function createLinkedFixture(t, target = 'CLAUDE.md') {
  const fixture = createFixture(t);
  writeFile(fixture.consumerRoot, target, 'Existing project instructions\r\n');
  fs.symlinkSync(target, path.join(fixture.consumerRoot, 'AGENTS.md'));
  return fixture;
}

function assertLink(root, destination = 'CLAUDE.md') {
  const link = path.join(root, 'AGENTS.md');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(link), destination);
}

function replaceLink(root, destination) {
  removeFile(root, 'AGENTS.md');
  fs.symlinkSync(destination, path.join(root, 'AGENTS.md'));
}

describe('install and uninstall: in-project AGENTS.md symlinks', () => {
  for (const target of ['CLAUDE.md', 'instructions/team.md']) {
    it(`installs rules in ${target} and records the target without replacing the link`, (t) => {
      const { consumerRoot, install } = createLinkedFixture(t, target);
      const original = readBytes(consumerRoot, target);

      install();

      assertLink(consumerRoot, target);
      assert.deepEqual(readBytes(consumerRoot, target).subarray(0, original.length), original);
      assert.equal(readJson(consumerRoot, MANIFEST_FILE).rules.target, target);
      assert.ok(readText(consumerRoot, target).includes(BEGIN));
      assert.ok(readText(consumerRoot, target).includes(END));
    });

    it(`repeating installation through ${target} leaves existing content and the link unchanged`, (t) => {
      const { consumerRoot, install } = createLinkedFixture(t, target);
      install();
      const before = snapshotFiles(consumerRoot);

      install();

      assertLink(consumerRoot, target);
      assert.deepEqual(snapshotFiles(consumerRoot), before);
    });

    it(`updates the managed rules in ${target} without replacing the link`, (t) => {
      const { consumerRoot, packageRoot, install } = createLinkedFixture(t, target);
      const original = readBytes(consumerRoot, target);
      install();
      writeFile(packageRoot, 'rules/AGENTS.md', 'Updated upstream rules\n');

      install();

      assertLink(consumerRoot, target);
      assert.deepEqual(readBytes(consumerRoot, target).subarray(0, original.length), original);
      assert.match(readText(consumerRoot, target), /Updated upstream rules/);
      assert.equal(readText(consumerRoot, target).split(BEGIN).length, 2);
    });
  }

  it('supports an absolute symlink to a regular file inside the project', (t) => {
    const { consumerRoot, install } = createLinkedFixture(t);
    replaceLink(consumerRoot, path.join(consumerRoot, 'CLAUDE.md'));

    install();

    assertLink(consumerRoot, path.join(consumerRoot, 'CLAUDE.md'));
    assert.equal(readJson(consumerRoot, MANIFEST_FILE).rules.target, 'CLAUDE.md');
  });

  it('preserves an in-project link chain', (t) => {
    const { consumerRoot, install } = createLinkedFixture(t);
    fs.symlinkSync('CLAUDE.md', path.join(consumerRoot, 'TEAM.md'));
    replaceLink(consumerRoot, 'TEAM.md');

    install();

    assertLink(consumerRoot, 'TEAM.md');
    assert.equal(fs.readlinkSync(path.join(consumerRoot, 'TEAM.md')), 'CLAUDE.md');
    assert.equal(readJson(consumerRoot, MANIFEST_FILE).rules.target, 'CLAUDE.md');
  });

  for (const flag of ['--dry-run', '--check']) {
    it(`${flag} inspects the target and does not modify the link or its contents`, (t) => {
      const fixture = createLinkedFixture(t);

      const result = assertReadOnlyCommand(fixture, [flag]);

      assert.equal(result.status, flag === '--check' ? 1 : 0, result.stderr);
      assert.match(result.stdout, /update: CLAUDE.md/);
      assertLink(fixture.consumerRoot);
      fixture.install();
      assert.equal(assertReadOnlyCommand(fixture, [flag]).status, 0);
    });
  }

  it('uninstall removes the managed block while retaining the target and link', (t) => {
    const { consumerRoot, install } = createLinkedFixture(t);
    const original = readBytes(consumerRoot, 'CLAUDE.md');
    install();

    const result = uninstall(consumerRoot);

    assert.deepEqual(result.preserved, []);
    assertLink(consumerRoot);
    assert.deepEqual(readBytes(consumerRoot, 'CLAUDE.md'), Buffer.concat([original, Buffer.from('\r\n')]));
    assert.equal(exists(consumerRoot, MANIFEST_FILE), false);
    assert.equal(exists(consumerRoot, SKILL_FILE), false);
  });

  it('preserves local target edits and retains target tracking during uninstall', (t) => {
    const { consumerRoot, install } = createLinkedFixture(t);
    install();
    const edited = `${BEGIN}\nLocally customized rules\n${END}\n`;
    writeFile(consumerRoot, 'CLAUDE.md', edited);

    const result = uninstall(consumerRoot);

    assert.deepEqual(result.preserved, ['CLAUDE.md']);
    assert.equal(readText(consumerRoot, 'CLAUDE.md'), edited);
    assertLink(consumerRoot);
    assert.equal(readJson(consumerRoot, MANIFEST_FILE).rules.target, 'CLAUDE.md');
  });

  for (const operation of ['install', 'uninstall']) {
    it(`${operation} refuses a retargeted link without adopting or changing either file`, (t) => {
      const fixture = createLinkedFixture(t);
      fixture.install();
      writeFile(fixture.consumerRoot, 'NEW.md', 'Another file\n');
      replaceLink(fixture.consumerRoot, 'NEW.md');
      const before = snapshotFiles(fixture.consumerRoot);

      assert.throws(() => operation === 'install' ? fixture.install() : uninstall(fixture.consumerRoot), /target changed/);

      assert.deepEqual(snapshotFiles(fixture.consumerRoot), before);
    });
  }

  it('supports moving a legacy regular AGENTS.md to CLAUDE.md without losing ownership', (t) => {
    const { consumerRoot, install } = createFixture(t);
    install();
    assert.equal(readJson(consumerRoot, MANIFEST_FILE).rules.target, undefined);
    fs.renameSync(path.join(consumerRoot, 'AGENTS.md'), path.join(consumerRoot, 'CLAUDE.md'));
    fs.symlinkSync('CLAUDE.md', path.join(consumerRoot, 'AGENTS.md'));

    install();

    assertLink(consumerRoot);
    assert.equal(readJson(consumerRoot, MANIFEST_FILE).rules.target, 'CLAUDE.md');
    assert.equal(readText(consumerRoot, 'CLAUDE.md').split(BEGIN).length, 2);
  });

  it('rolls back an install failure without replacing the link', (t) => {
    const fixture = createLinkedFixture(t);
    const before = snapshotFiles(fixture.consumerRoot);

    assert.throws(() => fixture.install({ beforeApply(operation) {
      if (operation.file === MANIFEST_FILE) throw new Error('Injected manifest failure');
    } }), /were restored/);

    assertLink(fixture.consumerRoot);
    assert.deepEqual(snapshotFiles(fixture.consumerRoot), before);
  });

  it('refuses a link retargeted after preflight and restores any skill writes', (t) => {
    const fixture = createLinkedFixture(t);
    writeFile(fixture.consumerRoot, 'OTHER.md', 'Do not modify\n');
    const original = readBytes(fixture.consumerRoot, 'CLAUDE.md');

    assert.throws(() => fixture.install({ beforeApply(operation) {
      if (operation.file === 'CLAUDE.md') replaceLink(fixture.consumerRoot, 'OTHER.md');
    } }), /target changed during operation/);

    assertLink(fixture.consumerRoot, 'OTHER.md');
    assert.deepEqual(readBytes(fixture.consumerRoot, 'CLAUDE.md'), original);
    assert.equal(readText(fixture.consumerRoot, 'OTHER.md'), 'Do not modify\n');
    assert.equal(exists(fixture.consumerRoot, SKILL_FILE), false);
    assert.equal(exists(fixture.consumerRoot, MANIFEST_FILE), false);
  });

  it('restores uninstall changes when its rules link is retargeted after preflight', (t) => {
    const fixture = createLinkedFixture(t);
    fixture.install();
    writeFile(fixture.consumerRoot, 'OTHER.md', 'Do not modify\n');
    const rulesBefore = readBytes(fixture.consumerRoot, 'CLAUDE.md');
    const skillBefore = readBytes(fixture.consumerRoot, SKILL_FILE);
    const manifestBefore = readBytes(fixture.consumerRoot, MANIFEST_FILE);

    assert.throws(() => uninstall(fixture.consumerRoot, { beforeApply(operation) {
      if (operation.file === 'CLAUDE.md') replaceLink(fixture.consumerRoot, 'OTHER.md');
    } }), /target changed during operation/);

    assertLink(fixture.consumerRoot, 'OTHER.md');
    assert.deepEqual(readBytes(fixture.consumerRoot, 'CLAUDE.md'), rulesBefore);
    assert.deepEqual(readBytes(fixture.consumerRoot, SKILL_FILE), skillBefore);
    assert.deepEqual(readBytes(fixture.consumerRoot, MANIFEST_FILE), manifestBefore);
    assert.equal(readText(fixture.consumerRoot, 'OTHER.md'), 'Do not modify\n');
  });
});

describe('install and uninstall: unsafe rules symlinks', () => {
  const unsafeTargets = [
    { name: 'a file outside the project', setup: ({ temporaryRoot, consumerRoot }) => {
      const outside = path.join(temporaryRoot, 'outside.md');
      fs.writeFileSync(outside, 'Outside instructions');
      fs.symlinkSync(outside, path.join(consumerRoot, 'AGENTS.md'));
    } },
    { name: 'a sibling with the same directory-name prefix', setup: ({ consumerRoot }) => {
      const outside = `${consumerRoot}-outside/instructions.md`;
      writeFile(path.dirname(outside), path.basename(outside), 'Outside instructions');
      fs.symlinkSync(outside, path.join(consumerRoot, 'AGENTS.md'));
    } },
    { name: 'a dangling target', setup: ({ consumerRoot }) => fs.symlinkSync('missing.md', path.join(consumerRoot, 'AGENTS.md')) },
    { name: 'a directory', setup: ({ consumerRoot }) => {
      fs.mkdirSync(path.join(consumerRoot, 'instructions'));
      fs.symlinkSync('instructions', path.join(consumerRoot, 'AGENTS.md'));
    } },
    { name: 'a link cycle', setup: ({ consumerRoot }) => fs.symlinkSync('AGENTS.md', path.join(consumerRoot, 'AGENTS.md')) },
    { name: 'the ownership manifest', setup: ({ consumerRoot }) => fs.symlinkSync(MANIFEST_FILE, path.join(consumerRoot, 'AGENTS.md')) },
    { name: 'a managed skill', setup: ({ consumerRoot }) => {
      fs.symlinkSync(SKILL_FILE, path.join(consumerRoot, 'AGENTS.md'));
    } },
  ];

  for (const { name, setup } of unsafeTargets) {
    it(`blocks ${name} without changing existing files`, (t) => {
      const fixture = createFixture(t);
      fixture.install();
      removeFile(fixture.consumerRoot, 'AGENTS.md');
      setup(fixture);
      const before = snapshotFiles(fixture.temporaryRoot);

      assert.throws(() => fixture.install(), /Unsafe|Cannot resolve/);
      assert.throws(() => uninstall(fixture.consumerRoot), /Unsafe|Cannot resolve/);
      assert.equal(assertReadOnlyCommand(fixture, ['--dry-run']).status, 1);
      assert.equal(assertReadOnlyCommand(fixture, ['--check']).status, 1);

      assert.deepEqual(snapshotFiles(fixture.temporaryRoot), before);
    });
  }
});
