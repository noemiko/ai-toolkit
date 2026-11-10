import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REGISTRY = 'https://npm.pkg.github.com';
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));

export function validateRelease(metadata, tag) {
  assert.match(tag || '', /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/, 'A stable vX.Y.Z release tag is required');
  assert.equal(tag, `v${metadata.version}`, 'Release tag must match package.json version');
  assert.equal(metadata.name, '@noemiko/ai-toolkit', 'Unexpected package identity');
  assert.equal(metadata.publishConfig?.registry, REGISTRY, 'Publishing is restricted to GitHub Packages');
  assert.notEqual(metadata.private, true, 'private: true prevents npm publication');
}

export async function runRelease({ cwd = sourceRoot, tag = process.env.RELEASE_TAG, dryRun = false } = {}) {
  const metadata = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  validateRelease(metadata, tag);
  if (!dryRun) {
    assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Publish through the manual GitHub Actions workflow');
    assert.ok(process.env.NPM_TOKEN, 'NPM_TOKEN is required for publication');
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    assert.equal(commit, process.env.RELEASE_COMMIT, 'Checkout must match the validated release commit');
  }

  // Run the plugin against a staging directory: prepare may rewrite package.json,
  // but release-please remains the only owner of the committed version.
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'ai-toolkit-release-'));
  try {
    const stage = path.join(temporaryRoot, 'package');
    mkdirSync(stage);
    for (const file of ['package.json', ...metadata.files]) {
      const relative = file.replace(/\/$/, '');
      assert.ok(relative && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), 'Unsafe publish file path');
      cpSync(path.join(cwd, relative), path.join(stage, relative), { recursive: true });
    }
    const plugin = await import('@semantic-release/npm');
    const configuration = { npmPublish: !dryRun, tarballDir: path.join(temporaryRoot, 'tarballs') };
    const context = {
      cwd: stage,
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
      options: {},
      stdout: process.stdout,
      stderr: process.stderr,
      logger: console,
      nextRelease: { version: metadata.version, gitTag: tag, channel: 'latest' },
    };
    await plugin.verifyConditions(configuration, context);
    await plugin.prepare(configuration, context);
    const release = await plugin.publish(configuration, context);
    if (!dryRun) assert.ok(release, 'The plugin did not publish the package');
    console.log(dryRun ? `Dry run passed: ${metadata.name}@${metadata.version}; nothing published.` : `Published ${metadata.name}@${metadata.version} to ${REGISTRY}.`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    assert.ok(process.argv.slice(2).every((arg) => arg === '--dry-run'), 'Only --dry-run is supported');
    await runRelease({ dryRun: process.argv.includes('--dry-run') });
  } catch (error) {
    console.error(`Release failed: ${error.message}`);
    process.exitCode = 1;
  }
}
