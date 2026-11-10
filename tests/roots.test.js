'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveRoot } = require('../install.js');
const { createFixture, writeFile, installDependencyCopy } = require('./helpers');

describe('install: choosing a consumer root', () => {
  it('manual installation finds the project above the current subdirectory', (t) => {
    const { consumerRoot, packageRoot } = createFixture(t);
    const nestedDirectory = path.join(consumerRoot, 'src/nested');
    fs.mkdirSync(nestedDirectory, { recursive: true });

    const root = resolveRoot({ cwd: nestedDirectory, env: {}, packageDir: packageRoot });

    assert.equal(root, fs.realpathSync(consumerRoot));
  });

  for (const caller of ['consumer subdirectory', 'unrelated package', 'missing directory', 'unset']) {
    it(`postinstall uses its enclosing consumer when INIT_CWD is ${caller}`, (t) => {
      const { temporaryRoot, consumerRoot, packageRoot } = createFixture(t);
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

  const rejectedRoots = [
    { name: 'the toolkit package itself', error: /itself/, options: ({ packageRoot }) => ({ cwd: packageRoot }) },
    { name: 'a global installation', error: /Global/, options: ({ consumerRoot }) => ({ cwd: consumerRoot, env: { npm_config_global: 'true' } }) },
    { name: 'a directory without an ancestor project', error: /No consumer/, options: ({ temporaryRoot }) => ({ cwd: temporaryRoot }) },
    { name: 'a consumer inside node_modules', error: /node_modules/, options: ({ consumerRoot }) => {
      const dependencyRoot = path.join(consumerRoot, 'node_modules/another-package');
      writeFile(dependencyRoot, 'package.json', '{}');
      return { cwd: dependencyRoot };
    } },
    { name: 'a workspace root', error: /Workspace/, options: ({ consumerRoot }) => {
      writeFile(consumerRoot, 'package.json', '{"workspaces":["packages/*"]}');
      return { cwd: consumerRoot };
    } },
  ];
  for (const { name, error, options } of rejectedRoots) {
    it(`rejects ${name}`, (t) => {
      const fixture = createFixture(t);

      assert.throws(() => resolveRoot({ env: {}, packageDir: fixture.packageRoot, ...options(fixture) }), error);
    });
  }
});
