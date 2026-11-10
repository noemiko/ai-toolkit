# Project Summary

`@noemiko/ai-toolkit` is a private npm toolkit for distributing shared AI skills
and rules through GitHub Packages. It uses dependency-free CommonJS JavaScript
and requires Node >=22.

## How it works

- `install.js` runs automatically through npm postinstall or manually through
  `ai-toolkit`. It copies bundled skills into the consumer's `.agents/skills/`
  and adds a sentinel-delimited rules block to project-root `AGENTS.md`.
- `.agents/.ai-toolkit-manifest.json` records package version, owned file paths,
  and delivered SHA-256 hashes. Updates change only tracked, unchanged content;
  conflicting files and malformed rules markers stop setup.
- `uninstall.js`, exposed as `ai-toolkit-uninstall`, removes unchanged owned
  content while preserving local edits and tracking unresolved items.
- Dependency postinstall targets the consumer enclosing the installed package's
  `node_modules`, rather than `INIT_CWD`. Source-development postinstall is a no-op.
- Automatic setup failures warn without failing npm install; incomplete manual
  operations return nonzero.

## Layout

- `skills/code-review/SKILL.md`: example review skill for team customization.
- `rules/AGENTS.md`: example rules copied into the consumer's managed block.
- `tests/`: installation, root selection, uninstall, recovery, and real npm
  package tests. See `tests/README.md` for the test map.
- `README.md`: consumer setup, authentication, lifecycle behavior, and publishing.

## Release automation

- CI runs lint and tests on Node 22/24 and a no-publish plugin dry run on Node 24.
- release-please owns version/changelog PRs and GitHub releases after green main CI.
- The manual publish workflow validates an existing stable release tag, retests
  its commit, and uses @semantic-release/npm to publish that exact version.
- Release dependencies and their lockfile live in `.github/release/`; they are
  excluded from the package. Never run a competing semantic-release version engine.
- Setup for RELEASE_PLEASE_TOKEN and the github-packages environment is in README.

## Working on this project

- Preserve consumer edits and unrelated files. Never infer ownership of existing
  untracked content, even when its bytes match the toolkit's artifacts.
- Keep credentials outside committed configuration. The installer must not alter
  consumer authentication or package scripts.
- Keep runtime code self-contained in the two published entry scripts. The package
  allowlist excludes development files, tests, and these project-summary files.
- Install development dependencies with `npm ci --ignore-scripts`. Run
  `npm run lint` and `npm test` from this directory. For focused checks, use
  `node --test tests/install.test.js` or another test file.
- Check the actual release inventory with `npm pack --dry-run --json`.
- Publishing is a separate action requiring explicit authorization and registry
  access; local tarball tests do not verify remote authentication or permissions.

`AGENT.md` is a relative symlink to this file; edit `CLAUDE.md` to update both.
