'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveRoot } = require('../install.js');
const { createProjectFixture, writeFile, installDependencyCopy } = require('./helpers');

describe('install: choosing a consumer root', () => {
  it('manual installation finds the project above the current subdirectory', (t) => {
    const { consumerRoot, packageRoot } = createProjectFixture(t);
    const nestedDirectory = path.join(consumerRoot, 'src/nested');
    fs.mkdirSync(nestedDirectory, { recursive: true });

    const root = resolveRoot({ cwd: nestedDirectory, env: {}, packageDir: packageRoot });

    assert.equal(root, fs.realpathSync(consumerRoot));
  });

  for (const caller of ['consumer subdirectory', 'unrelated package', 'missing directory', 'unset']) {
    it(`postinstall uses its enclosing consumer when INIT_CWD is ${caller}`, (t) => {
      const { temporaryRoot, consumerRoot, packageRoot } = createProjectFixture(t);
      const installedRoot = installDependencyCopy(consumerRoot, packageRoot);
      const nestedDirectory = path.join(consumerRoot, 'src');
      fs.mkdirSync(nestedDirectory);
      const callerDirectories = {
        'consumer subdirectory': nestedDirectory,
        'unrelated package': packageRoot,
        'missing directory': path.join(temporaryRoot, 'nonexistent'),
      };
      const environment = caller === 'unset' ? {} : { INIT_CWD: callerDirectories[caller] };

      const root = resolveRoot({ cwd: installedRoot, env: environment, packageDir: installedRoot, postinstall: true });

      assert.equal(root, fs.realpathSync(consumerRoot));
    });
  }

  it('rejects the toolkit package itself as the consumer', (t) => {
    const { packageRoot } = createProjectFixture(t);

    assert.throws(() => resolveRoot({ cwd: packageRoot, packageDir: packageRoot, env: {} }), /itself/);
  });

  it('rejects global installation', (t) => {
    const { consumerRoot, packageRoot } = createProjectFixture(t);

    assert.throws(() => resolveRoot({
      cwd: consumerRoot, packageDir: packageRoot, env: { npm_config_global: 'true' },
    }), /Global/);
  });

  it('rejects a directory without an ancestor project', (t) => {
    const { temporaryRoot, packageRoot } = createProjectFixture(t);

    assert.throws(() => resolveRoot({ cwd: temporaryRoot, packageDir: packageRoot, env: {} }), /No consumer/);
  });

  it('rejects a consumer inside node_modules', (t) => {
    const { consumerRoot, packageRoot } = createProjectFixture(t);
    const dependencyRoot = path.join(consumerRoot, 'node_modules/another-package');
    writeFile(dependencyRoot, 'package.json', '{}');

    assert.throws(() => resolveRoot({ cwd: dependencyRoot, packageDir: packageRoot, env: {} }), /node_modules/);
  });

  it('rejects a workspace root', (t) => {
    const { consumerRoot, packageRoot } = createProjectFixture(t);
    writeFile(consumerRoot, 'package.json', '{"workspaces":["packages/*"]}');

    assert.throws(() => resolveRoot({ cwd: consumerRoot, packageDir: packageRoot, env: {} }), /Workspace/);
  });
});
