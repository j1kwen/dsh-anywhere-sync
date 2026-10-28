# Config Sync for DeepSeek Harness

[![CI](https://github.com/j1kwen/dsh-harness-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/j1kwen/dsh-harness-sync/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/j1kwen/dsh-harness-sync)](LICENSE)

![Config Sync](assets/icon-180.png)

Sync a Harness profile — installed plugins, plugin configuration, dependency
locks, local plugin source, skills and other profile files — across machines
through **one private Git repository**. Every category is an independent
switch. A change made on one machine lands on the others at their next sync.

[中文说明](README.zh.md)

## Features

- **Six independently selectable sync items** — plugin manifest, local plugin
  source, plugin configuration (`cordis.patch.yml`), dependency lock, other
  profile files, and skills.
- **Three-way comparison** — local, remote and the last synced hash; only a file
  changed on both sides becomes a conflict.
- **Conflict handling** — remote wins (default), local wins, or keep conflicts
  and choose a side per file from the settings page.
- **Backups before every overwrite** — the last 10 runs under
  `$DSH_HOME/harness-sync/backups/`.
- **Automatic sync** — interval, sync on startup, and install dependencies after
  a pulled plugin manifest.
- **The plugin itself syncs** — source of every `link:`/`file:` plugin is stored
  under `local-plugins/<package>/` and written back to the matching install
  directory on the other machines.
- **No machine paths in the repository** — `link:`/`file:`/absolute specs and
  their lockfile blocks are projected out before anything is pushed.
- **Agent tool** — `harness_sync` exposes the same `status` / `sync` / `pull` /
  `push` / `install` operations to the model.
- **UI in Settings → Config Sync** — status, per-item file lists, conflict
  resolution, install and sync controls.

## Install

Requirements: DeepSeek Harness with the Web UI, Node.js 20+, and `git`.

```bash
dsh plugin --profile desktop add j1kwen/dsh-harness-sync
```

Then restart Harness and open **Settings → Config Sync**.

From a local checkout or the release tarball:

```bash
dsh plugin --profile desktop add /path/to/dsh-harness-sync
# or point the Plugin Manager at dsh-harness-sync.tgz from the latest release
```

The repository declares `dsh.bundle` and a `cordis.patch.yml`, which is what
makes it installable as a bundle.

## Quick start

1. Create a **private** Git repository for the synchronized configuration.
2. Create a Personal Access Token with `repo` (classic) or Contents read/write
   (fine-grained) access to it.
3. Open **Settings → Config Sync**, enter the repository URL, branch and token,
   then choose **Save and connect**.
4. Choose **Sync now**. On another machine, install this plugin, enter the same
   repository and token, and sync.
5. Enable **Scheduled sync** or **Sync on startup** to keep the machines
   converged.

After a pull that changes the plugin manifest, dependency install and a Harness
restart are required before the new plugins load.

## What syncs

| Item | Local source | Repository path | Default |
| --- | --- | --- | --- |
| Plugin manifest | `<profile>/package.json` | `profile/<profile>/package.json` | on |
| Local plugin source | directories of `link:` / `file:` / absolute dependencies | `local-plugins/<package>/…` | on |
| Plugin configuration | `<profile>/cordis.patch.yml` | `profile/<profile>/cordis.patch.yml` | on |
| Dependency lock | `<profile>/pnpm-lock.yaml`, `pnpm-workspace.yaml` | same | on |
| Other profile files | remaining profile config (presets, `config.toml`, …) | `profile/<profile>/…` | off |
| Skills | `~/.agents/skills/`, `~/.agents/.skill-lock.json` | `skills/…` | off |

Files that look like credentials (`.env*`, `*credential*`, `*secret*`,
`id_rsa*`, `*.pem`, `.npmrc`, `config.toml`, …) are excluded even when "Other
profile files" is on. A disabled item is neither read, written nor deleted.

## Local plugin source

`package.json` and `pnpm-lock.yaml` are projected into a portable form before
comparison or push: `link:`, `file:`, `workspace:` and absolute-path specs
(including the `link:` install of this plugin itself) are removed, together
with their bundle entries. When a remote manifest is pulled, local links are
merged back in, so each machine keeps its own install paths.

The source of every local dependency is carried under `local-plugins/<package>/`.
On pull:

- a machine that already links the package gets the source written back to its
  install directory;
- a machine without it gets a managed copy under
  `$DSH_HOME/harness-sync/local-plugins/<package>`, registered as a `link:`
  dependency; enable its bundle in the Plugins page if it is new;
- plugin code changes take effect after a Harness restart.

New machines still install this plugin once to get the settings page and the
initial sync.

## How it works

```text
fetch origin <branch> → reset --hard (the mirror is the remote truth)
  ↓ compare hash(local) / hash(remote) / hash(base) per file
  ├─ only local changed  → write into the mirror, commit, push
  ├─ only remote changed → write into the profile (backup first)
  └─ both changed       → conflict policy, or resolve per file
  ↓ record the new base hashes
```

Every push stages exactly the paths the run changed, so unrelated files in the
same repository (another profile, another tool) are never touched. A push that
loses a race with another machine is recomputed and retried once — never forced.

State lives in `$DSH_HOME/harness-sync/` (`config.json`, `state.json`,
`credentials.json`, `repo/`, `backups/`). The synced profile is the profile the
plugin is mounted in; the settings page shows its name.

## Security

- The token is stored on this machine only, in
  `$DSH_HOME/harness-sync/credentials.json` with mode `0600`. It is passed to
  git through a scoped `GIT_ASKPASS` environment variable, never written to the
  repository, a URL, a log or a browser response.
- Alternative token sources: `HARNESS_SYNC_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`.
- The HTTP API under `/harness-sync/api` reuses Harness Connection's Host/Origin
  and browser-login checks, falls back to loopback-only when that service is
  absent, and requires a same-origin `Origin` on mutating requests.
- Synced files, account credentials, sessions and workspaces are separate:
  `~/.dsh/.credentials.yaml`, session logs and workspace data are never read.
- The agent tool cannot read the token, change the repository, or change the
  selected sync items.
- No telemetry, analytics or outbound requests except the configured Git remote.

## Requirements and supported platforms

- DeepSeek Harness with the Web UI and the plugin manager (the `settings.section`
  and `webServer` services are used).
- Node.js 20+ in the Harness runtime; `git` on `PATH`.
- Designed for macOS, Linux and Windows. CI runs the offline engine and HTTP
  tests on Linux with Node 20 and 22; Windows path handling uses Node's `path`
  APIs but is not exercised by CI.

## Development

```bash
npm run verify   # package/manifest checks + offline engine and HTTP tests
```

The tests create their own temporary bare repositories; they never touch your
profile or the network:

- `scripts/engine-test.mjs` — push, pull, conflict, delete, multi-machine,
  local-link projection, local plugin registration.
- `scripts/http-test.mjs` — admission, same-origin, parameter validation, sync
  lifecycle.

GitHub Actions runs the same checks on every push and pull request.

## Release integrity

- Releases are built from a **signed tag** by GitHub Actions and published as
  `dsh-harness-sync.tgz` with `SHA256SUMS`.
- The tarball gets a **Sigstore build provenance attestation**, and the checksum
  file carries a keyless Sigstore signature (`SHA256SUMS.sigstore.json`):

  ```bash
  sha256sum -c SHA256SUMS
  gh attestation verify dsh-harness-sync.tgz --repo j1kwen/dsh-harness-sync
  cosign verify-blob --bundle SHA256SUMS.sigstore.json \
    --certificate-identity-regexp 'https://github.com/j1kwen/dsh-harness-sync/.github/workflows/release.yml@refs/tags/.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    SHA256SUMS
  ```

- Commits and tags are signed with the maintainer's registered SSH signing key;
  GitHub shows the Verified badge on the commit and tag.

## Limitations

- Text files only; a single file is capped at 5 MiB and larger files are
  reported and skipped.
- Plugin packages themselves are not installed from the repository; the plugin
  manifest and lock are synced, then the profile package manager installs them.
- A pulled local plugin is registered as a dependency but its bundle is not
  enabled automatically (that would reference a package before it is installed).
- `profileFiles` and `skills` are off by default; sync them only after deciding
  what may leave the machine.
- Git submodules, LFS and repository history cleanup are out of scope.

## License

MIT — see [LICENSE](LICENSE).
