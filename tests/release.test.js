'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SOURCE_ROOT, createFixture, readJson, snapshotFiles } = require('./helpers');

let validateRelease;
let runRelease;
before(async () => {
  ({ validateRelease, runRelease } = await import(pathToFileURL(path.join(SOURCE_ROOT, '.github/release/publish.mjs')).href));
});

describe('package release: publication guards', () => {
  it('accepts the package version selected by release-please without calculating another version', () => {
    const metadata = readJson(SOURCE_ROOT, 'package.json');

    assert.doesNotThrow(() => validateRelease(metadata, `v${metadata.version}`));
  });

  for (const tag of ['', 'main', 'v01.2.3', 'v1.0.0-beta.1', 'v1.0.0+build']) {
    it(`rejects ${tag ? `the invalid or unstable tag ${tag}` : 'an absent release tag'}`, () => {
      assert.throws(() => validateRelease(readJson(SOURCE_ROOT, 'package.json'), tag), /stable/);
    });
  }

  it('rejects a valid tag whose version differs from the package', () => {
    const metadata = readJson(SOURCE_ROOT, 'package.json');
    metadata.version = '7.8.9';

    assert.throws(() => validateRelease(metadata, 'v7.8.10'), /must match/);
  });

  for (const registry of ['https://registry.npmjs.org', undefined]) {
    it(`refuses publication when the registry is ${registry || 'missing'}`, () => {
      const metadata = readJson(SOURCE_ROOT, 'package.json');
      metadata.publishConfig.registry = registry;

      assert.throws(() => validateRelease(metadata, `v${metadata.version}`), /restricted to GitHub Packages/);
    });
  }

  it('rejects an unexpected package identity', () => {
    const metadata = readJson(SOURCE_ROOT, 'package.json');
    metadata.name = '@another-owner/ai-toolkit';

    assert.throws(() => validateRelease(metadata, `v${metadata.version}`), /Unexpected package/);
  });

  it('rejects private:true rather than reporting a skipped publish as success', () => {
    const metadata = readJson(SOURCE_ROOT, 'package.json');
    metadata.private = true;

    assert.throws(() => validateRelease(metadata, `v${metadata.version}`), /prevents npm publication/);
  });

  it('a mismatched release fails before staging files or calling the publishing plugin', async (t) => {
    const { packageRoot } = createFixture(t);
    const before = snapshotFiles(packageRoot);

    await assert.rejects(runRelease({ cwd: packageRoot, tag: 'v999.0.0', dryRun: true }), /must match/);

    assert.deepEqual(snapshotFiles(packageRoot), before);
  });
});
