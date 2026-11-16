'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { install } = require('../install.js');
const { name: PACKAGE_NAME } = require('../package.json');

const SOURCE_ROOT = path.resolve(__dirname, '..');
const SKILL_FILE = '.agents/skills/code-review/SKILL.md';
const BUNDLED_SKILL = 'skills/code-review/SKILL.md';
const MANIFEST_FILE = '.agents/.ai-toolkit-manifest.json';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function writeFile(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
}

function readBytes(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath));
}

function readText(root, relativePath) {
  return readBytes(root, relativePath).toString('utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function exists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function removeFile(root, relativePath) {
  fs.unlinkSync(path.join(root, relativePath));
}

function createTemporaryDirectory(testContext) {
  // Canonical paths keep npm's file identity consistent on macOS (/var aliases).
  const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-toolkit-test-')));
  testContext.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  return temporaryRoot;
}

// Root selection and npm integration need project metadata, not a source copy.
function createProjectFixture(testContext) {
  const temporaryRoot = createTemporaryDirectory(testContext);
  const consumerRoot = path.join(temporaryRoot, 'consumer');
  const packageRoot = path.join(temporaryRoot, 'distribution');
  writeFile(consumerRoot, 'package.json', JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }));
  writeFile(packageRoot, 'package.json', readBytes(SOURCE_ROOT, 'package.json'));
  return { temporaryRoot, consumerRoot, packageRoot };
}

// Installer tests need editable bundled artifacts and executable entry scripts.
function createFixture(testContext) {
  const fixture = createProjectFixture(testContext);
  const { consumerRoot, packageRoot } = fixture;
  fs.cpSync(SOURCE_ROOT, packageRoot, {
    recursive: true,
    filter: (file) => !['tests', 'node_modules', '.git'].includes(path.basename(file)),
  });

  return {
    ...fixture,
    install: (options = {}) => install(consumerRoot, { packageDir: packageRoot, ...options }),
  };
}

// Compare file bytes and link destinations, not empty directories or permissions.
function snapshotFiles(root) {
  const files = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isSymbolicLink()) files[relativePath] = { link: fs.readlinkSync(absolutePath) };
      else files[relativePath] = { bytes: fs.readFileSync(absolutePath).toString('base64') };
    }
  }
  visit(root);
  return files;
}

// A read-only command must also preserve directories, permissions and mtimes.
function snapshotTree(root) {
  const entries = {};
  function visit(file) {
    const stat = fs.lstatSync(file);
    entries[path.relative(root, file)] = { mode: stat.mode, mtime: stat.mtimeMs };
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) visit(path.join(file, name));
    }
  }
  visit(root);
  return { entries, files: snapshotFiles(root) };
}

function assertReadOnlyCommand(fixture, args, command = 'install.js') {
  const consumerBefore = snapshotTree(fixture.consumerRoot);
  const packageBefore = snapshotTree(fixture.packageRoot);

  const result = runCommand(process.execPath, [path.join(fixture.packageRoot, command), ...args], fixture.consumerRoot);

  assert.deepEqual(snapshotTree(fixture.consumerRoot), consumerBefore, 'Command must not modify the consumer');
  assert.deepEqual(snapshotTree(fixture.packageRoot), packageBefore, 'Command must not modify the package');
  return result;
}

function commandEnvironment(overrides) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^npm_/i.test(key) || ['INIT_CWD', 'NODE_OPTIONS', 'NODE_TEST_CONTEXT'].includes(key)) {
      delete environment[key];
    }
  }
  return { ...environment, ...overrides };
}

function runCommand(program, args, cwd, environment = {}) {
  const result = spawnSync(program, args, {
    cwd,
    env: commandEnvironment(environment),
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.ifError(result.error && new Error([
    `Could not run ${program} ${args.join(' ')} in ${cwd}: ${result.error.message}`,
    `stdout:\n${result.stdout || ''}`,
    `stderr:\n${result.stderr || ''}`,
  ].join('\n'), { cause: result.error }));
  return result;
}

function assertCommandSucceeded(result) {
  assert.equal(result.status, 0, [
    `Exit status: ${result.status}; signal: ${result.signal}`,
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
  ].join('\n'));
}

function installDependencyCopy(consumerRoot, packageRoot) {
  const installedRoot = path.join(consumerRoot, 'node_modules', PACKAGE_NAME);
  fs.cpSync(packageRoot, installedRoot, { recursive: true });
  return installedRoot;
}

function runBin(consumerRoot, commandName, args = []) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  return runCommand(path.join(consumerRoot, 'node_modules/.bin', commandName + extension), args, consumerRoot);
}

function packSource(outputDirectory) {
  // Pack the real source, including development files, so inventory assertions
  // actually verify that npm excludes tests and other unpublished content.
  const result = runCommand(npm, [
    'pack', '--json', '--pack-destination', outputDirectory, '--ignore-scripts',
  ], SOURCE_ROOT);
  assertCommandSucceeded(result);
  const output = JSON.parse(result.stdout);
  // npm 10/11 return an array; npm 12 keys results by package name.
  const packed = Array.isArray(output) ? output[0] : output[PACKAGE_NAME];
  assert.ok(packed && typeof packed.filename === 'string' && Array.isArray(packed.files),
    `Unexpected npm pack output:\n${result.stdout}`);
  return { archivePath: path.join(outputDirectory, packed.filename), files: packed.files.map((file) => file.path).sort() };
}

function allowTarballScripts(consumerRoot, archivePath) {
  const metadata = readJson(consumerRoot, 'package.json');
  // npm 12 approves file dependencies by resolved file identity, not by the
  // package name inside their tarball. Trust only this test's generated archive.
  const identity = `file:${fs.realpathSync(archivePath).split(path.sep).join('/')}`;
  metadata.allowScripts = { ...metadata.allowScripts, [identity]: true };
  writeFile(consumerRoot, 'package.json', JSON.stringify(metadata));
}

module.exports = {
  SOURCE_ROOT, PACKAGE_NAME, SKILL_FILE, BUNDLED_SKILL, MANIFEST_FILE, npm,
  writeFile, readBytes, readText, readJson, exists, removeFile,
  createTemporaryDirectory, createProjectFixture, createFixture,
  snapshotFiles, assertReadOnlyCommand, runCommand, assertCommandSucceeded,
  installDependencyCopy, runBin, packSource, allowTarballScripts,
};
