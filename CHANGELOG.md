# Changelog

## 1.1.1

- Fix the file-list request losing its `?item=` query string, which made the
  settings page report `item is unknown`.
- Use the host's filled-button and business-accent theme tokens so primary
  buttons, link buttons, switches and focus rings stay legible in dark mode.
- Add `npm run check` (manifest, locale, icon, file list and secret scan),
  GitHub Actions CI on Node 20/22, a signed-tag release workflow with Sigstore
  build provenance, and package/README metadata for distribution.

## 1.1.0

- Add **Local plugin source** as a sixth sync item: `link:`/`file:` plugin
  directories are stored under `local-plugins/<package>/` and written back to
  the matching install directory on pull; a machine without the package gets a
  managed copy and a `link:` dependency.
- Project machine-local dependency specs and lockfile blocks out of the synced
  manifest/lock, and merge local links back in on pull.
- Refuse to propagate deletion of `package.json`; restore it from the side that
  still has it.
- Report skipped/unreadable/oversized files and excluded credentials in the UI.

## 1.0.0

- Initial release: six settings items, three-way sync, conflict modes, backups,
  scheduled/startup sync, dependency install, `harness_sync` agent tool and the
  Settings → Config Sync page.
