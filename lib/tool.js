/**
 * `harness_sync` — the same operations the settings page offers, for the agent.
 *
 * The canonical value is a compact summary, not the page's full status: the
 * model needs "configured? synced? what changed? what conflicts?", and the
 * token is never part of any status value in the first place.
 */
import { SyncError, toFailure } from './errors.js'

export function registerSyncTool(ctx, engine) {
  return ctx.tools.register({
    name: 'harness_sync',
    description:
      'Synchronize this machine\'s Harness profile with the shared private Git repository configured in Settings → Config Sync. '
      + 'Actions: "status" reports configuration, selected items, last sync, pending dependency install and conflicts without changing anything; '
      + '"sync" pulls remote changes and pushes local changes (the normal choice); "pull" only applies remote changes; "push" only publishes local changes; '
      + '"install" runs the profile package manager install step after a pulled plugin manifest (usually unnecessary: sync does it automatically when enabled). '
      + 'The repository URL, branch, sync items and conflict policy are user settings; this tool cannot change them, cannot read the access token, and cannot see or transmit credentials. '
      + 'A file changed on two machines since the last sync is a conflict and is reported by path instead of being overwritten.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'sync', 'pull', 'push', 'install'],
          description: 'status reads only; sync/pull/push transfer files; install runs the package manager.',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', description: 'False when the action failed or a sync reported an error.' },
          action: { type: 'string', description: 'The requested action.' },
          error: { type: 'string', description: 'Failure code and detail when ok is false.' },
          status: {
            type: 'object',
            description: 'Compact state for the status action.',
            additionalProperties: true,
            properties: {
              configured: { type: 'boolean' },
              repoUrl: { type: 'string' },
              branch: { type: 'string' },
              lastSyncAt: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              running: { type: 'boolean' },
              pendingInstall: { type: 'boolean' },
              conflicts: { type: 'array', items: { type: 'string' } },
            },
          },
          result: {
            type: 'object',
            description: 'Compact outcome for a transfer action.',
            additionalProperties: true,
            properties: {
              pulled: { type: 'number' },
              pushed: { type: 'number' },
              conflicts: { type: 'array', items: { type: 'string' } },
              installOk: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            },
          },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderValue(value) }]
      },
    },
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted?.()
      const action = typeof args?.action === 'string' ? args.action : 'status'
      try {
        if (action === 'status') {
          const status = await engine.status()
          return {
            ok: true,
            action,
            status: {
              configured: status.repoConfigured,
              repoUrl: status.repoUrl,
              branch: status.branch,
              lastSyncAt: status.lastSyncAt,
              running: status.running,
              pendingInstall: status.pendingInstall,
              conflicts: status.conflicts.map(conflict => conflict.path),
              items: status.items.map(item => `${item.id}:${item.enabled ? 'on' : 'off'}:${item.count}`),
              lastError: status.lastResult?.error ?? null,
            },
          }
        }
        if (action === 'install') {
          const installed = await engine.install()
          return {
            ok: installed.ok === true,
            action,
            ...(installed.ok === true ? {} : { error: installed.code ?? 'install-failed' }),
            install: { ok: installed.ok === true, exitCode: installed.exitCode ?? null },
          }
        }
        const mode = action === 'pull' ? 'pull' : action === 'push' ? 'push' : 'both'
        const result = await engine.sync(mode)
        return {
          ok: result.error === null,
          action,
          ...(result.error === null ? {} : { error: `${result.error.code}: ${result.error.message}` }),
          result: {
            pulled: result.pulled.length,
            pushed: result.pushed.length,
            conflicts: result.conflicts.map(conflict => conflict.path),
            installOk: result.install === null ? null : result.install.ok === true,
            commit: result.commit,
          },
        }
      } catch (error) {
        const failure = toFailure(error)
        return { ok: false, action, error: `${failure.code}: ${failure.message}` }
      }
    },
  })
}

function renderValue(value) {
  if (value === null || typeof value !== 'object') return String(value)
  const lines = []
  if (value.status !== undefined) {
    const status = value.status
    lines.push(`Config Sync: ${status.configured === true ? 'configured' : 'not configured'}`)
    if (status.repoUrl) lines.push(`repository: ${status.repoUrl} (${status.branch})`)
    lines.push(`last sync: ${status.lastSyncAt ?? 'never'}`)
    lines.push(`items: ${(status.items ?? []).join(', ')}`)
    lines.push(`conflicts: ${status.conflicts.length === 0 ? 'none' : status.conflicts.join(', ')}`)
    if (status.pendingInstall === true) lines.push('dependency install pending')
    if (status.lastError) lines.push(`last error: ${status.lastError.code}: ${status.lastError.message}`)
  }
  if (value.result !== undefined) {
    const result = value.result
    lines.push(`${value.action}: pulled ${result.pulled ?? 0}, pushed ${result.pushed ?? 0}`)
    if ((result.conflicts ?? []).length > 0) lines.push(`conflicts: ${result.conflicts.join(', ')}`)
    if (result.installOk === true) lines.push('dependencies installed')
    if (result.installOk === false) lines.push('dependency install failed')
    if (result.commit) lines.push(`commit: ${result.commit}`)
  }
  if (value.install !== undefined) {
    lines.push(value.install.ok === true ? 'dependencies installed' : `dependency install failed (exit ${value.install.exitCode})`)
  }
  if (value.error) lines.push(`error: ${value.error}`)
  return `${value.ok === true ? '' : 'FAILED — '}${lines.join('\n')}`
}

/** Re-exported for the Host entry point's error mapping. */
export { SyncError }
