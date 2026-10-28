/**
 * dsh-anywhere-sync — Host half.
 *
 * Owns the sync engine, the `/anywhere-sync/api` routes the settings page talks
 * to, the `anywhere_sync` agent tool, and the optional auto-sync timer. The
 * Client half only renders; every operation lives here so the page and the
 * agent cannot diverge.
 */
import { SyncEngine } from './lib/engine.js'
import { createRuntime } from './lib/paths.js'
import { createRouteHandler } from './lib/routes.js'
import { registerSyncTool } from './lib/tool.js'

const STARTUP_DELAY_MS = 8_000

export function apply(ctx) {
  const profileContext = ctx.get('profileContext')
  const runtime = createRuntime(profileContext)
  const logger = (message, detail) => {
    if (detail === undefined) console.log(message)
    else console.log(message, detail)
  }

  let timer = null
  let startupTimer = null

  const engine = new SyncEngine({
    runtime,
    logger,
    getPackageManager: () => packageManagerOf(ctx),
    onConfigChanged: () => scheduleAutoSync(),
  })

  /** Recreate the interval from the saved configuration. */
  function scheduleAutoSync() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    const config = engine.config
    if (!config.autoSync || config.repoUrl === '') return
    const interval = Math.max(1, config.intervalMinutes) * 60_000
    timer = setInterval(() => {
      if (engine.running !== null) return
      void engine.sync('both').then((result) => {
        if (result.error !== null) logger(`[anywhere-sync] auto sync: ${result.error.code}: ${result.error.message}`)
      }).catch((error) => logger(`[anywhere-sync] auto sync crashed: ${String(error?.message ?? error)}`))
    }, interval)
    timer.unref?.()
  }

  ctx.effect(() => {
    logger(`[anywhere-sync] profile=${runtime.profileName} dir=${runtime.profileDir}`)
    scheduleAutoSync()
    if (engine.config.syncOnStartup && engine.config.repoUrl !== '') {
      startupTimer = setTimeout(() => {
        if (engine.running !== null) return
        void engine.sync('both').then((result) => {
          if (result.error !== null) logger(`[anywhere-sync] startup sync: ${result.error.code}: ${result.error.message}`)
        }).catch((error) => logger(`[anywhere-sync] startup sync crashed: ${String(error?.message ?? error)}`))
      }, STARTUP_DELAY_MS)
      startupTimer.unref?.()
    }
    return () => {
      if (timer !== null) clearInterval(timer)
      if (startupTimer !== null) clearTimeout(startupTimer)
      timer = null
      startupTimer = null
      engine.dispose()
    }
  }, 'anywhere-sync: lifetime')

  // The settings page needs the web server. A headless profile still gets the
  // tool and the timer, so the plugin degrades instead of throwing.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/anywhere-sync/api',
      handler: createRouteHandler({ engine, getContext: () => webCtx, logger }),
    }), 'anywhere-sync: routes')
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => {
      try {
        return registerSyncTool(toolCtx, engine)
      } catch (error) {
        // A name collision or an older tool registry must not take the
        // settings page down with it.
        console.warn(`[anywhere-sync] agent tool unavailable: ${String(error?.message ?? error)}`)
        return () => {}
      }
    }, 'anywhere-sync: tool')
  })
}

/**
 * The launcher publishes the profile's package manager as `{command, args,
 * env}`. Every field is checked: a half-usable invocation would run the wrong
 * binary with the wrong environment, so anything incomplete falls back to pnpm
 * on the augmented PATH.
 */
function packageManagerOf(ctx) {
  try {
    const profileContext = ctx.get('profileContext')
    const candidate = profileContext !== null && typeof profileContext === 'object'
      ? profileContext.packageManager
      : undefined
    if (candidate === null || typeof candidate !== 'object') return null
    if (typeof candidate.command !== 'string' || candidate.command.trim() === '') return null
    if (!Array.isArray(candidate.args) || candidate.args.some(arg => typeof arg !== 'string')) return null
    const env = {}
    if (candidate.env !== null && typeof candidate.env === 'object' && !Array.isArray(candidate.env)) {
      for (const [key, value] of Object.entries(candidate.env)) {
        if (typeof value === 'string') env[key] = value
      }
    }
    return { command: candidate.command.trim(), args: [...candidate.args], env }
  } catch {
    return null
  }
}
