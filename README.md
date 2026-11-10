# AI Toolkit

A dependency-free starter for distributing team AI artifacts as the private npm
package `@noemiko/ai-toolkit` through GitHub Packages. Requires Node >=22 and npm.
The bundled code-review skill and rules are generic examples: customize and review
them before adopting them as team policy.

## Consumer setup

Commit an `.npmrc` containing only this registry mapping:

```ini
@noemiko:registry=https://npm.pkg.github.com
```

Do not add authentication entries to that committed file. The installer never
changes your npm configuration or package scripts and never needs your token.

### Local authentication

Use your GitHub username and a personal access token (classic) with `read:packages`
and access to the private package. Authorize organizational SSO if required.
Store login in your user configuration, outside the repository:

```sh
npm login --scope=@noemiko --registry=https://npm.pkg.github.com --auth-type=legacy
npm install --save-dev @noemiko/ai-toolkit
```

Alternatively configure your own user-level npm authentication. Never commit tokens.
See [GitHub's npm registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

### CI authentication

Supply `GH_PKG_TOKEN` using your CI secret store. Use a token with package read
access, or a GitHub Actions `GITHUB_TOKEN` with `packages: read` and explicit access
to this package. A token cannot grant access the workflow/repository does not have.
Run the following in a POSIX shell; it creates user configuration outside the
checkout and writes only an environment-variable reference, never the token:

```sh
set -eu
: "${GH_PKG_TOKEN:?Supply a package-read token from CI secrets}"
toolkit_auth_dir=$(mktemp -d)
trap 'rm -rf "$toolkit_auth_dir"' EXIT
export NPM_CONFIG_USERCONFIG="$toolkit_auth_dir/npmrc"
printf '%s\n' '//npm.pkg.github.com/:_authToken=${GH_PKG_TOKEN}' > "$NPM_CONFIG_USERCONFIG"
npm ci
```

Do not print the token, upload this temporary file, or append auth to the project's
`.npmrc`. No consumer `preinstall` helper is needed.

## Installation and updates

Postinstall copies `skills/code-review/` into `.agents/skills/code-review/`, adds
one marked block to project-root `AGENTS.md`, and writes
`.agents/.ai-toolkit-manifest.json`. The manifest records package version, file
ownership and SHA-256 baselines. Commit the generated artifacts and their manifest
together if your team checks them in; retain the manifest for updates and uninstall.

```text
<!-- BEGIN @noemiko/ai-toolkit -->
...
<!-- END @noemiko/ai-toolkit -->
```

For npm installations with scripts disabled, or to retry setup, run from the
consumer project (or one of its subdirectories):

```sh
npm exec --offline -- ai-toolkit
```

The package must already be installed locally. Its command is also available at
`./node_modules/.bin/ai-toolkit`. Repeat installation is idempotent. Update with:

```sh
npm update @noemiko/ai-toolkit
npm exec --offline -- ai-toolkit
```

The installer updates only previously tracked, unchanged files. It does not adopt
untracked existing files, even when their content matches. Move conflicting files
to a backup outside the skill directory, or restore the last delivered version,
before retrying. Modified obsolete files also stop updates. Unrelated files in
skill directories and bytes outside the rules block are preserved.

Keep the rules markers intact. A lone, repeated or reversed marker stops setup
before any writes. An untracked or edited rules block also requires manual
resolution. Preserve your edits before restoring a delivered block. A malformed
manifest must be repaired from a known-good copy; deleting it loses ownership and
makes existing artifacts untracked conflicts. Do not fabricate hashes to claim files.

## Uninstall

Run cleanup **before** removing the npm dependency:

```sh
npm exec --offline -- ai-toolkit-uninstall
npm uninstall @noemiko/ai-toolkit
```

Cleanup removes only unchanged tracked skill files and the unchanged managed rules
block. It keeps edited files and edited/malformed blocks, reports their paths,
returns nonzero, and retains tracking only for those unresolved items. Restore
those items to their delivered contents or remove them manually, then rerun cleanup
before removing the dependency. Keep a backup if you want the edits.

Missing files count as already removed. Missing manifest means no cleanup is
attempted. Repeated completed cleanup is harmless. Only empty skill directories
are pruned; unrelated directories and `AGENTS.md` remain, even if the file is empty.
No npm uninstall lifecycle hook is used.

## Roots and failures

Manual commands search upward from the current directory for the nearest
`package.json`. Dependency postinstall uses the consumer enclosing the installed
package's `node_modules` directory. It ignores `INIT_CWD`, which can identify a
different calling project when `npm --prefix` selects the installation target.
Global installs, workspace-root targeting and
consumer roots inside `node_modules` are unsupported. There is no workspace
selection option. Toolkit-source postinstall is a no-op during package development.

Conflicts, invalid manifests, malformed markers and unsafe paths are checked before
writes. Symlink destinations and traversal are rejected. On caught write failures,
the operation attempts to restore prior content without overwriting subsequent
edits; incomplete recovery is reported with affected paths. Individual files and
the manifest are published atomically, but a crash or forced termination can leave
an incomplete multi-file operation. Inspect and preserve artifacts before retrying.

Automatic postinstall reports setup failures but exits successfully so dependency
installation can finish. A successful `npm install` therefore does not prove toolkit
setup completed. Manual commands return nonzero on errors or unresolved cleanup.
Use `npm install --foreground-scripts` when diagnosing lifecycle output.

## Maintainer workflow

This package uses the GitHub owner `noemiko`. Before a real release:

1. Confirm that `noemiko` is the intended GitHub owner in the package name and
   documentation; the runtime derives its markers and identity from package.json.
   Update package-contract tests for that chosen identity. Renaming an already
   installed package requires cleaning up the old identity first.
2. Customize and review the example skill and rules.
3. Add the correct GitHub `repository` metadata if repository linkage is desired.
   Authenticate with package-write access and prepare private package permissions
   and consumer/workflow access in GitHub.
4. Verify locally, inspect the archive, and publish manually when authorized:

```sh
npm test
npm pack --dry-run --json
npm publish --registry=https://npm.pkg.github.com
```

Do not set `private: true` in package.json: that prevents npm publication entirely.
Manage private visibility and access in GitHub Packages. Do not commit publishing
credentials. Publishing and release automation are outside this starter change.

For a local trial without registry credentials, from the package directory run
`npm pack --pack-destination /path/to/output`, then install the resulting tarball
in a temporary npm project. The test suite does this automatically and checks both
bin commands, lifecycle-disabled setup, and package contents.

Local tarball verification does **not** establish GitHub authentication, private
visibility, repository permissions or remote installation. Check these separately
with an authorized consumer after publishing. The test suite uses Node's built-in
runner and makes no registry requests for dependencies.
# ai-toolkit
