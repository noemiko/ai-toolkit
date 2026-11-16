# Reading the tests

Each test names one outcome. Read its setup, the installation/uninstall action,
and the assertions that describe the consumer's resulting files or command exit.
Parameterized cases name the reason for rejection instead of printing raw inputs.

| File | What it protects |
|---|---|
| `install.test.js` | File ownership, safe updates, rule preservation, invalid manifests and unsafe paths |
| `symlink-rules.test.js` | Safe in-project rules aliases, preserved links, target ownership and retarget rejection |
| `inspection.test.js` | Read-only previews, drift detection, exit status and unchanged files/directories |
| `roots.test.js` | Choosing the intended consumer and rejecting unsupported targets |
| `uninstall.test.js` | Removing only owned content and preserving local edits |
| `failure.test.js` | Rollback, concurrent edits, filesystem failures and CLI exit behavior |
| `package.test.js` | Public npm metadata, actual tarball contents, installed commands and npm --prefix regression |
| `release.test.js` | Prevents wrong-registry, wrong-version and invalid-tag publication |
| `helpers.js` | Temporary consumers, read-only assertions and subprocess diagnostics |

From the package directory, run everything with `npm test`, or one area with:

```sh
node --test tests/install.test.js
node --test tests/package.test.js
```

The plan's existing name filters also work, but overlap: `install` matches
`uninstall`, and descriptive test names can include `package`. Use file selection
when you want a specific area rather than a phase gate.

Why keep similar-looking cases? Untracked identical files and locally edited
files matching the next release have different ownership histories. Hook-injected
failures and actual filesystem publication failures exercise different recovery
boundaries. Unit root checks and the real npm --prefix test cover logic and npm's
actual lifecycle environment respectively.

Snapshots compare file bytes and symlink destinations. They do not claim that
empty directories or filesystem permissions were restored. The shared
`assertReadOnlyCommand` helper also checks directories, file modes and timestamps
in both the consumer and package trees.

Use `createProjectFixture` when a test needs only project metadata. Use
`createFixture` when it needs runnable scripts or editable bundled artifacts.
`createTemporaryDirectory` provides an empty scratch directory. Each fixture
cleans up after its test.

Tarball checks pack
the real source into a temporary directory so exclusion of development files is
actually tested. All consumer artifacts are created outside the checkout.
