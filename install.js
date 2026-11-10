#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const metadata = require('./package.json');
const PACKAGE = metadata.name;
const BEGIN = `<!-- BEGIN ${PACKAGE} -->`;
const END = `<!-- END ${PACKAGE} -->`;
const MANIFEST = '.agents/.ai-toolkit-manifest.json';
const RULES = 'AGENTS.md';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => a === null || b === null ? a === b : a.equals(b);

function statIfPresent(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function safePath(root, relative, file = true) {
  const parts = relative.split('/');
  if (!relative || parts.some((part) => !part || part === '.' || part === '..' || /[\\:\0]/.test(part))) {
    throw new Error(`Unsafe relative path: ${relative}`);
  }
  let current = root;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    const stat = statIfPresent(current);
    if (!stat) continue;
    const last = index === parts.length - 1;
    if (stat.isSymbolicLink() || (!last && !stat.isDirectory()) ||
        (last && (file ? !stat.isFile() : !stat.isDirectory()))) {
      throw new Error(`Unsafe or unexpected file type: ${current}`);
    }
  }
  return current;
}

function read(root, relative) {
  const file = safePath(root, relative);
  try { return fs.readFileSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function skillPath(value) {
  return typeof value === 'string' && /^\.agents\/skills\/[^/]+\/.+/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..' && !/[\\:\0]/.test(part));
}

function readManifest(root) {
  const bytes = read(root, MANIFEST);
  if (bytes === null) return { bytes, value: null };
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`Invalid JSON in ${MANIFEST}; preserve and repair it before retrying.`); }
  const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  if (!record(value) || value.schemaVersion !== 1 || value.package !== PACKAGE ||
      typeof value.version !== 'string' || !value.version || !record(value.files) ||
      !Object.entries(value.files).every(([file, sum]) => skillPath(file) && digest(sum)) ||
      !(value.rules === null || (record(value.rules) && value.rules.path === RULES &&
        value.rules.begin === BEGIN && value.rules.end === END && digest(value.rules.sha256)))) {
    throw new Error(`Unsupported or malformed ${MANIFEST}; preserve and repair it before retrying.`);
  }
  for (const file of Object.keys(value.files)) safePath(root, file);
  return { bytes, value };
}

function parseRules(bytes) {
  if (bytes === null) return null;
  const positions = (marker) => {
    const found = [];
    for (let offset = 0; (offset = bytes.indexOf(marker, offset)) !== -1; offset += Buffer.byteLength(marker)) found.push(offset);
    return found;
  };
  const begins = positions(BEGIN);
  const ends = positions(END);
  if (!begins.length && !ends.length) return null;
  if (begins.length !== 1 || ends.length !== 1 || begins[0] >= ends[0]) {
    throw new Error(`Malformed toolkit markers in ${RULES}; expected exactly one ordered BEGIN/END pair.`);
  }
  const start = begins[0];
  const end = ends[0] + Buffer.byteLength(END);
  return { start, end, bytes: bytes.subarray(start, end) };
}

function nearestProject(start) {
  let current = path.resolve(start);
  while (true) {
    if (statIfPresent(path.join(current, 'package.json'))?.isFile()) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`No consumer package.json found above ${start}.`);
    current = parent;
  }
}

function resolveRoot({ cwd = process.cwd(), env = process.env, packageDir = __dirname, postinstall = false } = {}) {
  if (env.npm_config_global === 'true' || env.npm_config_global === '1') {
    throw new Error('Global installation is unsupported; install the toolkit in a local npm project.');
  }
  // npm --prefix may leave INIT_CWD pointing at a different project. A source
  // checkout must never install its artifacts into that unrelated project.
  if (postinstall && !path.resolve(packageDir).split(path.sep).includes('node_modules')) return null;
  let start = cwd;
  if (postinstall) {
    // INIT_CWD describes the caller, which can differ from npm's --prefix target.
    // The installed package's enclosing node_modules identifies its consumer.
    const parts = path.resolve(packageDir).split(path.sep);
    const index = parts.lastIndexOf('node_modules');
    start = parts.slice(0, index).join(path.sep) || path.parse(packageDir).root;
  }
  const root = fs.realpathSync(nearestProject(start));
  const own = fs.realpathSync(packageDir);
  if (root === own) {
    throw new Error('The toolkit package itself cannot be the consumer project.');
  }
  if (root.split(path.sep).includes('node_modules')) throw new Error('Consumer root cannot be inside node_modules.');
  const project = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (project.workspaces) throw new Error('Workspace roots are unsupported; use a standalone npm consumer project.');
  return root;
}

function bundledFiles(packageDir) {
  const files = new Map();
  function walk(relative) {
    const absolute = safePath(packageDir, relative, false);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else {
        const destination = `.agents/${next}`;
        if (!entry.isFile() || !skillPath(destination)) throw new Error(`Unsafe bundled skill: ${next}`);
        files.set(destination, fs.readFileSync(safePath(packageDir, next)));
      }
    }
  }
  walk('skills');
  if (!files.size) throw new Error('No bundled skill files found.');
  return files;
}

// Atomic publication of a single file. New destinations use a no-replace link.
function atomicWrite(root, relative, bytes, expected) {
  const file = safePath(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  safePath(root, relative);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: statIfPresent(file)?.mode & 0o777 || 0o644 });
    if (!equal(read(root, relative), expected)) throw new Error(`File changed during operation: ${relative}`);
    if (expected === null) fs.linkSync(temporary, file);
    else fs.renameSync(temporary, file);
  } finally {
    // Cleanup cannot invalidate an already completed publication.
    try { fs.unlinkSync(temporary); } catch (error) {
      if (error.code !== 'ENOENT') console.error(`ai-toolkit: could not clean temporary file ${temporary}: ${error.message}`);
    }
  }
}

function prune(root, files) {
  for (const file of files) {
    let dir = path.posix.dirname(file);
    while (dir.startsWith('.agents/skills/')) {
      safePath(root, dir, false);
      try { fs.rmdirSync(path.join(root, dir)); }
      catch (error) { if (['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) break; throw error; }
      dir = path.posix.dirname(dir);
    }
  }
}

// beforeApply is an in-process fault-injection seam; it is not a CLI option.
function apply(root, operations, { beforeApply } = {}) {
  const completed = [];
  try {
    for (const [index, operation] of operations.entries()) {
      if (equal(operation.before, operation.after)) continue;
      beforeApply?.(operation, index);
      if (!equal(read(root, operation.file), operation.before)) throw new Error(`File changed during operation: ${operation.file}`);
      if (operation.after === null) fs.unlinkSync(safePath(root, operation.file));
      else atomicWrite(root, operation.file, operation.after, operation.before);
      completed.push(operation);
    }
  } catch (error) {
    const unresolved = [];
    for (const operation of completed.reverse()) {
      try {
        if (!equal(read(root, operation.file), operation.after)) throw new Error('subsequently changed', { cause: error });
        if (operation.before === null) fs.unlinkSync(safePath(root, operation.file));
        else atomicWrite(root, operation.file, operation.before, operation.after);
      } catch { unresolved.push(operation.file); }
    }
    throw new Error(`${error.message}${unresolved.length ? ` Recovery incomplete; inspect: ${unresolved.join(', ')}.` : ' Changes from this operation were restored.'}`, { cause: error });
  }
}

function install(root, { packageDir = __dirname, beforeApply } = {}) {
  const { bytes: previousBytes, value: previous } = readManifest(root);
  const incoming = bundledFiles(packageDir);
  const operations = [];
  const files = Object.create(null);
  for (const file of new Set([...incoming.keys(), ...Object.keys(previous?.files || {})])) {
    const before = read(root, file);
    if (before !== null && (!previous?.files[file] || hash(before) !== previous.files[file])) {
      throw new Error(`Conflicting skill file: ${file}. Move it outside the skill directory or restore its delivered version before retrying.`);
    }
    const after = incoming.get(file) ?? null;
    if (after !== null) files[file] = hash(after);
    operations.push({ file, before, after });
  }
  const rulesBefore = read(root, RULES);
  const block = parseRules(rulesBefore);
  if (block && (!previous?.rules || hash(block.bytes) !== previous.rules.sha256)) {
    throw new Error(`Conflicting managed rules in ${RULES}; preserve local edits before retrying.`);
  }
  const rulesSource = read(packageDir, 'rules/AGENTS.md');
  if (rulesSource === null) throw new Error('Missing bundled rules/AGENTS.md.');
  const text = rulesSource.toString('utf8').trimEnd();
  if (text.includes(BEGIN) || text.includes(END)) throw new Error('Bundled rules must not contain toolkit sentinel markers.');
  const newline = rulesBefore?.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const replacement = Buffer.from(`${BEGIN}${newline}${text.replace(/\r?\n/g, newline)}${newline}${END}`);
  let rulesAfter;
  if (block) rulesAfter = Buffer.concat([rulesBefore.subarray(0, block.start), replacement, rulesBefore.subarray(block.end)]);
  else {
    const prefix = rulesBefore ?? Buffer.alloc(0);
    const separator = prefix.length && prefix[prefix.length - 1] !== 10 ? Buffer.from(newline) : Buffer.alloc(0);
    rulesAfter = Buffer.concat([prefix, separator, replacement, Buffer.from(newline)]);
  }
  operations.push({ file: RULES, before: rulesBefore, after: rulesAfter });
  const version = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
  const manifest = { schemaVersion: 1, package: PACKAGE, version, files,
    rules: { path: RULES, begin: BEGIN, end: END, sha256: hash(replacement) } };
  operations.push({ file: MANIFEST, before: previousBytes, after: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  apply(root, operations, { beforeApply });
  try { prune(root, operations.filter((op) => op.after === null).map((op) => op.file)); }
  catch (error) { throw new Error(`Artifacts installed, but empty-directory cleanup is incomplete: ${error.message}`, { cause: error }); }
  return manifest;
}

function run(action, { postinstall = false } = {}) {
  try {
    if (process.argv.length > 2) throw new Error('No CLI arguments are supported; run the command from your consumer project.');
    const root = resolveRoot({ postinstall });
    if (root === null) { console.log('ai-toolkit: source-package postinstall skipped.'); return; }
    const result = action(root);
    if (result?.preserved?.length) {
      console.error(`ai-toolkit: cleanup incomplete; preserved local edits: ${result.preserved.join(', ')}. Restore delivered content or remove these items manually before retrying.`);
      process.exitCode = 1;
    } else console.log(`ai-toolkit: ${action === install ? 'installed' : 'uninstalled'} in ${root}.`);
  } catch (error) {
    console.error(`ai-toolkit: ${postinstall ? 'artifacts were not fully installed' : 'operation failed'}: ${error.message} Resolve the reported issue, then rerun ${action === install ? 'ai-toolkit' : 'ai-toolkit-uninstall'} from your project.`);
    process.exitCode = postinstall ? 0 : 1;
  }
}

module.exports = { PACKAGE, BEGIN, END, MANIFEST, RULES, hash, read, readManifest, parseRules, resolveRoot, safePath, apply, prune, install, run };
if (require.main === module) run(install, { postinstall: process.env.npm_lifecycle_event === 'postinstall' });
