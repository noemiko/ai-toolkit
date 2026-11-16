# AI Toolkit

Shared AI skills and rules for your team.

Package: **`@noemiko/ai-toolkit`** · Requires **Node 22+** and the **npm CLI**.

The package is hosted on **GitHub Packages**. You need a GitHub account.
You do **not** need an npmjs.com account. npm is the command-line tool used here.

The included code-review skill and rules are examples. Adapt them to your team.

- [Install in your project](#install-in-your-project)
- [Daily use](#daily-use)
- [Publish a release](#publish-a-release)

## Install in your project

Run these steps in the project where you want to use the toolkit.
Use a regular npm project with a `package.json`. Global installs and workspace
selection are not supported.

### 1. Set the registry

Create a project `.npmrc` with this line:

```ini
@noemiko:registry=https://npm.pkg.github.com
```

Commit this file. Keep tokens out of it.

### 2. Log in to GitHub Packages

Create a [GitHub token (classic)](https://github.com/settings/tokens/new)
with `read:packages`. Your GitHub account must have access to the package.
Authorize the token for your organization’s SSO if required.

```sh
npm login --scope=@noemiko --registry=https://npm.pkg.github.com --auth-type=legacy
npm whoami --registry=https://npm.pkg.github.com
```

At the prompts, enter:

- **Username:** your own GitHub username.
- **Password:** your GitHub token, not your account password.

Use a classic token for local package access. A fine-grained token or an npmjs.com
login will not work for this registry. Store credentials in your user configuration,
outside the repository.

### 3. Install and apply

```sh
npm install --save-dev @noemiko/ai-toolkit
npm exec --offline -- ai-toolkit
```

The second command applies the skills and rules. It is safe to repeat.
It also works when npm blocks automatic install scripts, as npm 12 does by default.

For automatic setup on npm 12, you can add this field to your project’s
`package.json`:

```json
"allowScripts": { "@noemiko/ai-toolkit": true }
```

The toolkit does not change your authentication, package scripts, or script policy.

## Daily use

Run these commands from your project. The package must already be installed.

**Preview changes.** Write nothing:

```sh
npm exec --offline -- ai-toolkit --dry-run
```

**Check setup.** Write nothing. Exit `0` means current; exit `1` means changes or
conflicts need attention. This does not look for newer versions in the registry.

```sh
npm exec --offline -- ai-toolkit --check
```

**Update the package and apply its changes:**

```sh
npm update @noemiko/ai-toolkit
npm exec --offline -- ai-toolkit
```

**Uninstall.** Clean up toolkit files before removing the dependency:

```sh
npm exec --offline -- ai-toolkit-uninstall
npm uninstall @noemiko/ai-toolkit
```

If cleanup reports local edits, keep the dependency until you resolve them and
rerun cleanup. Uninstall does not accept `--dry-run` or `--check`.

## What changes in your project?

- `.agents/skills/code-review/` gets the review skill.
- `AGENTS.md` gets a marked block of team rules.
- `.agents/.ai-toolkit-manifest.json` records the version and managed content.

The rules block uses these markers:

```text
<!-- BEGIN @noemiko/ai-toolkit -->
...
<!-- END @noemiko/ai-toolkit -->
```

Keep the markers and manifest. They let the toolkit identify its own content.
If you commit generated skills and rules, commit the manifest with them.

Updates change only tracked content that you have not edited. Existing untracked
files are conflicts, even if their content matches. Other project content stays
untouched. Uninstall removes unchanged managed content and preserves local edits.
It keeps tracking for any items it could not remove. It also keeps `AGENTS.md`
and any unrelated files.

### If AGENTS.md points to CLAUDE.md

`AGENTS.md -> CLAUDE.md` is supported. The toolkit keeps the link and edits only
its marked block in the target file.

The target must be an existing file inside your project. Outside targets, broken
links, link cycles, directories, and targets under `.agents`, `.git`, or
`node_modules` are blocked. Skills and the manifest cannot be symlink destinations.

To change a tracked link’s target: uninstall the old block, change the link, then
reinstall. If you changed it too early, restore the previous target before cleanup.

## Fix common problems

**`ENEEDAUTH`:** log in with the GitHub Packages command in step 2. A login to
`registry.npmjs.org` does not authenticate you to `npm.pkg.github.com`.

**Conflicting file or rules block:** back up your edits. Move an untracked file
outside the skill directory, or restore a tracked file/block to its delivered
content. Then rerun `ai-toolkit`. The toolkit does not merge local edits.

**Missing or repeated rules markers:** restore one matching BEGIN/END pair before
retrying. Do not append another block.

**Invalid manifest:** restore a known-good copy. Deleting it loses ownership
information and can make existing toolkit files become conflicts.

**Setup did not run:** execute `npm exec --offline -- ai-toolkit`. Automatic
postinstall errors produce a warning but do not fail `npm install`. Manual
commands return nonzero when they fail. Use `npm install --foreground-scripts`
to see lifecycle output.

Validation runs before writes. Caught write failures trigger rollback where
possible. A crash or forced stop can still leave partial setup. Preserve affected
files and inspect the error before retrying. Preview and check do not test write
permissions or lock files against other processes.

## Use in another repository’s CI

Commit the registry-only `.npmrc` from step 1. Add a CI secret named `GH_PKG_TOKEN`
with package-read access. A GitHub Actions `GITHUB_TOKEN` also works if it has
`packages: read` and the package grants access to that repository.

Run this in a POSIX shell. It keeps authentication outside the checkout:

```sh
set -eu
: "${GH_PKG_TOKEN:?Set a package-read token in CI secrets}"
toolkit_auth_dir=$(mktemp -d)
trap 'rm -rf "$toolkit_auth_dir"' EXIT
export NPM_CONFIG_USERCONFIG="$toolkit_auth_dir/npmrc"
printf '%s\n' '//npm.pkg.github.com/:_authToken=${GH_PKG_TOKEN}' > "$NPM_CONFIG_USERCONFIG"
npm ci
npm exec --offline -- ai-toolkit
npm exec --offline -- ai-toolkit --check
```

Use `npm ci` after committing a lockfile that includes the toolkit.
Do not print tokens or commit authentication files.
