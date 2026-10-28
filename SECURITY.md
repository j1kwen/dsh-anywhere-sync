# Security policy

## Supported versions

Security fixes are applied to the latest 1.x release.

## Reporting a vulnerability

Please do **not** open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting:

<https://github.com/j1kwen/dsh-anywhere-sync/security/advisories/new>

If private reporting is unavailable, contact [@j1kwen](https://github.com/j1kwen)
through GitHub with a minimal description and reproduction. You will get an
acknowledgement, an assessment, and a coordinated disclosure date.

## Security model

Anywhere Sync moves configuration text between machines. It deliberately does not
handle account credentials or session data.

- **Tokens** are stored only in `$DSH_HOME/anywhere-sync/credentials.json`
  (mode `0600`) or supplied through `ANYWHERE_SYNC_TOKEN` / `GH_TOKEN` /
  `GITHUB_TOKEN`. A token reaches git through a scoped `GIT_ASKPASS` environment
  variable; it is never committed, placed in a remote URL, written to a log, or
  returned by the HTTP API.
- **HTTP API** routes under `/anywhere-sync/api` reuse the Harness Connection
  Host/Origin and browser-authentication checks, fall back to loopback-only when
  that service is absent, and require a same-origin `Origin` header for mutating
  requests.
- **Never synced**: `~/.dsh/.credentials.yaml`, session logs, workspace data,
  files that look like credentials (`.env*`, `*.pem`, `.npmrc`, `config.toml`,
  ...), and anything outside the selected profile/skill/local-plugin paths.
- **No telemetry** or outbound requests other than the configured Git remote.
- **Agent tool** `anywhere_sync` can only read status and run sync/install
  operations; it cannot change the repository, token or selected items.

## Supply chain

- Releases are built by GitHub Actions from a signed tag, published with
  `SHA256SUMS`, and carry a Sigstore build provenance attestation
  (`gh attestation verify dsh-anywhere-sync.tgz --repo j1kwen/dsh-anywhere-sync`).
- Tags and commits are signed with the maintainer's registered SSH signing key.
- The package has no npm dependencies; the runtime uses Node.js built-ins only,
  and the client imports React through the Harness module table.
