/**
 * The sync engine: one operation, three callers (settings page, agent tool,
 * auto-sync timer).
 *
 * Design in one paragraph. The repository branch is the shared document; the
 * plugin keeps a sha256 base hash for every synced path. Each run fetches the
 * branch tip, computes `localChanged = local != base` and
 * `remoteChanged = remote != base` per path, and then applies only the side
 * that changed. A path changed on both sides with different contents is a
 * conflict: the configured mode resolves it automatically or it is returned to
 * the UI, where each side can be chosen explicitly. Pushes are ordinary fast
 * commits restricted to the paths this run changed, so unrelated files in the
 * same repository (other profiles, other tools) are never touched.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { SyncError, toFailure } from './errors.js'
import {
  ITEM_DEFINITIONS, ITEM_IDS, fileSummary, invalidateLocalPluginCache, isValidPackageName,
  itemOfRepoPath, localInventory, localPathFor, localPluginNameOfRepoPath, managedLocalPluginDir,
  mergeManifest, remoteInventory, resolveLocalDependencyDir, selectedFiles,
} from './items.js'
import {
  commitAndPush, gitAvailable, listRemoteBranches, normalizeRepoUrl, prepareRepository, validateBranch,
} from './git.js'
import { inspectGitHubRepository } from './github.js'
import { CONFLICT_MODES, SyncStore } from './store.js'

const INVENTORY_TTL_MS = 5_000
const INSTALL_TIMEOUT_MS = 10 * 60_000
const MAX_BACKUPS = 10
const MAX_LISTED_FILES = 500

export class SyncEngine {
  /**
   * @param {object} options
   * @param {ReturnType<import('./paths.js').createRuntime>} options.runtime
   * @param {(message: string, detail?: unknown) => void} [options.logger]
   * @param {() => ({ command: string, args: string[], env: Record<string, string> } | null)} [options.getPackageManager]
   * @param {Record<string, string | undefined>} [options.env]
   */
  constructor({ runtime, logger, getPackageManager, env = process.env, onConfigChanged }) {
    this.runtime = runtime
    this.logger = logger ?? (() => {})
    this.getPackageManager = getPackageManager ?? (() => null)
    this.env = env
    this.store = new SyncStore(runtime)
    this.running = null
    this.phase = null
    this.inventoryCache = null
    this.githubInfo = null
    this.installState = { running: false, lastExitCode: null, lastOutput: '', at: null }
    this.gitReady = null
    this.disposed = false
    this.onConfigChanged = typeof onConfigChanged === 'function' ? onConfigChanged : () => {}
  }

  log(message, detail) {
    try {
      this.logger(`[harness-sync] ${message}`, detail)
    } catch {
      // Logging must never fail a sync.
    }
  }

  // ---------------------------------------------------------------- config

  get config() {
    return this.store.config
  }

  tokenInfo() {
    const saved = this.store.token
    if (saved !== '') return { token: saved, source: 'file' }
    for (const name of ['HARNESS_SYNC_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
      const value = this.env[name]
      if (typeof value === 'string' && value.trim() !== '') return { token: value.trim(), source: 'env' }
    }
    return { token: '', source: 'none' }
  }

  /**
   * Merge a partial patch into the saved configuration and persist it.
   * A new repository or branch invalidates the mirror and every base hash.
   */
  async saveConfig(patch = {}) {
    const current = this.store.config
    const next = { ...current, items: { ...current.items } }
    const repoChanged = Object.hasOwn(patch, 'repoUrl')
    const branchChanged = Object.hasOwn(patch, 'branch')

    if (repoChanged) {
      const raw = typeof patch.repoUrl === 'string' ? patch.repoUrl.trim() : ''
      next.repoUrl = raw === '' ? '' : normalizeRepoUrl(raw)
    }
    if (branchChanged) {
      const raw = typeof patch.branch === 'string' ? patch.branch.trim() : ''
      mkdirSync(this.runtime.repoDir, { recursive: true })
      next.branch = raw === '' ? current.branch : await validateBranch(this.runtime, raw)
    }
    if (patch.items !== null && typeof patch.items === 'object' && !Array.isArray(patch.items)) {
      for (const id of ITEM_IDS) {
        if (typeof patch.items[id] === 'boolean') next.items[id] = patch.items[id]
      }
    }
    for (const key of ['autoSync', 'syncOnStartup', 'autoInstall']) {
      if (typeof patch[key] === 'boolean') next[key] = patch[key]
    }
    if (typeof patch.intervalMinutes === 'number') next.intervalMinutes = patch.intervalMinutes
    if (typeof patch.conflictMode === 'string' && CONFLICT_MODES.includes(patch.conflictMode)) {
      next.conflictMode = patch.conflictMode
    }

    const urlChanged = next.repoUrl !== current.repoUrl
    const targetBranchChanged = next.branch !== current.branch

    if (typeof patch.token === 'string' && patch.token.trim() !== '') {
      this.store.token = patch.token
    }
    if (patch.clearToken === true) this.store.token = ''

    this.store.saveConfig(next)
    this.invalideteInventory()
    invalidateLocalPluginCache(this.runtime)
    this.githubInfo = null

    if (urlChanged || targetBranchChanged) {
      this.log(`repository changed; resetting mirror (url=${urlChanged}, branch=${targetBranchChanged})`)
      rmSync(this.runtime.repoDir, { recursive: true, force: true })
      this.store.state.base = {}
      this.store.state.conflicts = []
      this.store.state.lastResult = null
      this.store.state.lastCommit = null
      this.store.state.pendingInstall = false
      this.store.saveState()
    }
    try {
      this.onConfigChanged(this.store.config)
    } catch {
      // A scheduler callback must never fail a save.
    }
    return this.store.config
  }

  // ------------------------------------------------------------- inventory

  invalideteInventory() {
    this.inventoryCache = null
  }

  inventory(force = false) {
    const now = Date.now()
    if (!force && this.inventoryCache !== null && now - this.inventoryCache.at < INVENTORY_TTL_MS) {
      return this.inventoryCache.value
    }
    const value = localInventory(this.runtime)
    this.inventoryCache = { at: now, value }
    return value
  }

  itemSummaries() {
    const inventory = this.inventory()
    const byItem = new Map(ITEM_IDS.map(id => [id, []]))
    for (const entry of inventory.files.values()) {
      const list = byItem.get(entry.item)
      if (list !== undefined) list.push(entry)
    }
    return ITEM_DEFINITIONS.map(definition => {
      const entries = byItem.get(definition.id) ?? []
      entries.sort((a, b) => a.repoPath.localeCompare(b.repoPath))
      return {
        id: definition.id,
        enabled: this.store.config.items[definition.id] === true,
        secretRisk: definition.secretRisk === true,
        count: entries.length,
        bytes: entries.reduce((total, entry) => total + entry.size, 0),
        sample: entries.slice(0, 6).map(entry => ({ path: entry.repoPath, size: entry.size })),
      }
    })
  }

  listFiles(itemId) {
    const inventory = this.inventory()
    const files = [...inventory.files.values()]
      .filter(entry => entry.item === itemId)
      .sort((a, b) => a.repoPath.localeCompare(b.repoPath))
    return {
      item: itemId,
      total: files.length,
      truncated: files.length > MAX_LISTED_FILES,
      files: fileSummary(files.slice(0, MAX_LISTED_FILES)),
    }
  }

  // ---------------------------------------------------------------- status

  async status() {
    const config = this.store.config
    const state = this.store.state
    const token = this.tokenInfo()
    if (this.gitReady !== true) this.gitReady = await gitAvailable()
    let warnings = []
    let warningTotal = 0
    let countsAvailable = true
    let items
    try {
      items = this.itemSummaries()
      const inventoryWarnings = this.inventory().warnings
      warnings = inventoryWarnings.slice(0, 20)
      warningTotal = inventoryWarnings.length
    } catch (error) {
      countsAvailable = false
      items = ITEM_DEFINITIONS.map(definition => ({
        id: definition.id,
        enabled: config.items[definition.id] === true,
        secretRisk: definition.secretRisk === true,
        count: 0,
        bytes: 0,
        sample: [],
      }))
      warnings = [{ repoPath: '', reason: 'inventory-failed', message: String(error?.message ?? error) }]
      warningTotal = 1
    }
    return {
      profile: this.runtime.profileName,
      profileDir: this.runtime.profileDir,
      skillsRoot: this.runtime.skillsRoot,
      dshHome: this.runtime.dshHome,
      repoUrl: config.repoUrl,
      branch: config.branch,
      repoConfigured: config.repoUrl !== '',
      repoReady: existsSync(resolve(this.runtime.repoDir, '.git')),
      gitReady: this.gitReady === true,
      tokenSet: token.source !== 'none',
      tokenSource: token.source,
      items,
      countsAvailable,
      autoSync: config.autoSync,
      intervalMinutes: config.intervalMinutes,
      syncOnStartup: config.syncOnStartup,
      autoInstall: config.autoInstall,
      conflictMode: config.conflictMode,
      instanceId: state.instanceId,
      lastSyncAt: state.lastSyncAt,
      lastCommit: state.lastCommit,
      lastResult: compactResult(state.lastResult),
      conflicts: state.conflicts,
      pendingInstall: state.pendingInstall,
      running: this.running !== null,
      phase: this.phase,
      install: { ...this.installState },
      github: this.githubInfo,
      warnings,
      warningTotal,
    }
  }

  // -------------------------------------------------------------- connect

  /**
   * Prove the URL, token and branch without writing anything except caches.
   * @param {{ repoUrl?: string, branch?: string, token?: string }} input
   */
  async connect(input = {}) {
    const config = this.store.config
    const url = normalizeRepoUrl(input.repoUrl ?? config.repoUrl)
    mkdirSync(this.runtime.repoDir, { recursive: true })
    const branch = await validateBranch(this.runtime, input.branch ?? config.branch)
    const typed = typeof input.token === 'string' ? input.token.trim() : ''
    const token = typed !== '' ? typed : this.tokenInfo().token

    if (!(await gitAvailable())) {
      throw new SyncError('git-missing', 'git is not installed or is not on PATH (install Git, then retry)')
    }

    // GitHub first: it distinguishes "wrong token" from "no repository" with
    // a message the UI can act on. Non-GitHub remotes skip straight to git.
    const github = await inspectGitHubRepository(url, token)
    const branches = await listRemoteBranches(this.runtime, url, token)
    const defaultBranch = github?.defaultBranch ?? (branches.includes('main') ? 'main' : (branches[0] ?? 'main'))
    const branchExists = branches.includes(branch)
    this.githubInfo = github === null ? null : {
      fullName: github.fullName,
      private: github.private,
      defaultBranch: github.defaultBranch,
      canPush: github.canPush,
      htmlUrl: github.htmlUrl,
    }
    this.log(`connected to ${url} branch=${branch} branches=${branches.length}`)
    return {
      repoUrl: url,
      branch,
      branches,
      branchExists,
      emptyRemote: branches.length === 0,
      defaultBranch,
      canPush: github?.canPush ?? null,
      github: this.githubInfo,
      tokenSource: token === '' ? 'none' : (typed !== '' ? 'typed' : this.tokenInfo().source),
    }
  }

  // ------------------------------------------------------------------ sync

  /**
   * Run one sync. Only one may run at a time; the second caller gets `busy`.
   * @param {'both'|'push'|'pull'} mode
   */
  sync(mode = 'both') {
    if (this.running !== null) throw new SyncError('busy', 'another sync is already running')
    const selectedMode = mode === 'push' || mode === 'pull' ? mode : 'both'
    const promise = (async () => {
      try {
        return await this.#runSync(selectedMode)
      } catch (error) {
        // Preconditions (no repository, missing git, invalid branch) reject
        // before #runSync installs its own handler. Record them like any other
        // failed run so the page and the tool both see the reason.
        const failure = toFailure(error)
        const result = {
          at: new Date().toISOString(),
          mode: selectedMode,
          pulled: [],
          pushed: [],
          conflicts: [],
          resolved: [],
          skipped: [],
          warnings: [],
          backup: null,
          commit: null,
          install: null,
          error: failure,
          durationMs: 0,
        }
        this.store.state.lastResult = result
        this.store.state.conflicts = []
        this.store.state.history = [...(this.store.state.history ?? []), {
          at: result.at,
          mode: result.mode,
          pulled: 0,
          pushed: 0,
          conflicts: 0,
          error: failure.code,
        }].slice(-20)
        this.store.saveState()
        this.log(`sync failed before start: ${failure.code}`)
        return result
      } finally {
        this.running = null
        this.phase = null
        this.invalideteInventory()
      }
    })()
    this.running = promise
    return promise
  }

  async #runSync(mode) {
    const startedAt = Date.now()
    const config = this.store.config
    const state = this.store.state
    const result = {
      at: new Date(startedAt).toISOString(),
      mode,
      pulled: [],
      pushed: [],
      conflicts: [],
      resolved: [],
      skipped: [],
      warnings: [],
      backup: null,
      commit: null,
      install: null,
      error: null,
      durationMs: 0,
    }

    if (config.repoUrl === '') throw new SyncError('no-config', 'set a repository URL first')
    if (!(await gitAvailable())) throw new SyncError('git-missing', 'git is not installed or is not on PATH')
    // The manifest may have changed since the last inventory (another tool
    // installed a local plugin); rediscover local sources for this run.
    invalidateLocalPluginCache(this.runtime)
    const url = normalizeRepoUrl(config.repoUrl)
    const branch = await validateBranch(this.runtime, config.branch)
    const token = this.tokenInfo().token

    let attempt = 0
    try {
      for (attempt = 0; attempt < 2; attempt += 1) {
        try {
          this.phase = 'fetching'
          const prepared = await prepareRepository(this.runtime, { url, branch, token })

          this.phase = 'comparing'
          const local = localInventory(this.runtime)
          const remote = remoteInventory(this.runtime)
          result.warnings.push(...local.warnings.slice(0, 20), ...remote.warnings.slice(0, 20))
          const localSelected = selectedFiles(local.files, config)
          const remoteSelected = selectedFiles(remote.files, config)
          const plan = planSync(this.runtime, localSelected, remoteSelected, state.base, config, mode)

          // Pull side: write/remove local files, backing up every overwrite.
          if (plan.pulls.length > 0) {
            this.phase = 'applying'
            const backupTargets = plan.pulls
              .map(entry => ({ repoPath: entry.repoPath, absolute: localPathFor(this.runtime, entry.repoPath) }))
              .filter(entry => entry.absolute !== null && existsSync(entry.absolute))
            if (backupTargets.length > 0) result.backup = backupFiles(this.runtime, backupTargets)
            for (const entry of plan.pulls) {
              const absolute = localPathFor(this.runtime, entry.repoPath)
              if (absolute === null) {
                result.warnings.push({ repoPath: entry.repoPath, reason: 'unmapped-path' })
                continue
              }
              if (entry.remote === null) {
                removeFile(absolute)
                result.pulled.push({ path: entry.repoPath, item: entry.item, action: 'delete' })
              } else {
                // The manifest on this machine keeps its own local-link
                // dependencies: the remote form is portable, the local form
                // may need a link this machine installed from disk.
                const buffer = entry.item === 'plugins'
                  ? mergeManifest(entry.remote.buffer, absolute)
                  : entry.remote.buffer
                writeLocalFile(absolute, buffer, buffer.length)
                result.pulled.push({ path: entry.repoPath, item: entry.item, action: 'write', size: buffer.length })
              }
            }
          }

          // Newly materialized local plugins need a manifest entry on this
          // machine before the install step can link them.
          this.#registerLocalPlugins(result)

          // Push side: mirror the chosen local content into the work tree.
          const pushPaths = []
          for (const entry of plan.pushes) {
            const repoPath = repoAbsolutePath(this.runtime, entry.repoPath)
            if (repoPath === null) {
              result.warnings.push({ repoPath: entry.repoPath, reason: 'unmapped-path' })
              continue
            }
            if (entry.local === null) {
              removeFile(repoPath)
              pushPaths.push(entry.repoPath)
              result.pushed.push({ path: entry.repoPath, item: entry.item, action: 'delete' })
            } else {
              writeLocalFile(repoPath, entry.local.buffer, entry.local.size)
              pushPaths.push(entry.repoPath)
              result.pushed.push({ path: entry.repoPath, item: entry.item, action: 'write', size: entry.local.size })
            }
          }

          let pushResult = { pushed: false, commit: null, files: 0 }
          if (pushPaths.length > 0 && mode !== 'pull') {
            this.phase = 'pushing'
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            const message = `sync(${this.runtime.profileName}): ${state.instanceId} ${stamp} (${pushPaths.length} file${pushPaths.length === 1 ? '' : 's'})`
            pushResult = await commitAndPush(this.runtime, { branch, token, paths: pushPaths, message })
            result.commit = pushResult.commit
            // A push that staged nothing means the remote already had the
            // exact content; that is still a success, not an error.
          }

          result.conflicts = plan.conflicts
          result.resolved = plan.resolved
          result.skipped = plan.skipped

          // Commit the base only for what actually reached both sides.
          for (const entry of plan.pulls) accountBase(state.base, entry.repoPath, entry.remote?.hash ?? null)
          for (const entry of plan.unchanged) accountBase(state.base, entry.repoPath, entry.hash)
          for (const entry of plan.pushes) {
            // A push that produced no commit still means the remote already
            // held this exact content, so the base is correct either way.
            accountBase(state.base, entry.repoPath, entry.local?.hash ?? null)
          }
          state.conflicts = plan.conflicts
          if (result.pulled.some(entry => entry.action === 'write' && (entry.item === 'plugins' || entry.item === 'lock' || entry.item === 'localPlugins'))) {
            state.pendingInstall = true
          }
          break
        } catch (error) {
          if (error instanceof SyncError && error.code === 'push-rejected' && attempt === 0) {
            // Another machine pushed between our fetch and our push. Fetch
            // again and recompute; never force over the other machine.
            result.warnings.push({ repoPath: '', reason: 'push-rejected-retry' })
            this.log('push rejected (remote moved); retrying once')
            continue
          }
          throw error
        }
      }

      // Install dependencies after a pull that changed the plugin manifest or
      // the lock file. The UI can also ask explicitly.
      const pluginFilesChanged = result.pulled.some(entry => entry.action === 'write' && (entry.item === 'plugins' || entry.item === 'lock' || entry.item === 'localPlugins'))
      if (pluginFilesChanged && config.autoInstall) {
        this.phase = 'installing'
        result.install = await this.install()
      }
      return result
    } catch (error) {
      result.error = toFailure(error)
      return result
    } finally {
      result.durationMs = Date.now() - startedAt
      result.pulledTotal = result.pulled.length
      result.pushedTotal = result.pushed.length
      state.lastResult = result
      state.conflicts = result.conflicts
      state.lastSyncAt = result.error === null ? result.at : (state.lastSyncAt ?? null)
      if (result.commit !== null) state.lastCommit = result.commit
      state.history = [...(state.history ?? []), {
        at: result.at,
        mode: result.mode,
        pulled: result.pulled.length,
        pushed: result.pushed.length,
        conflicts: result.conflicts.length,
        error: result.error === null ? null : result.error.code,
      }].slice(-20)
      this.store.saveState()
      this.log(`sync ${result.error === null ? 'finished' : 'failed'} pulled=${result.pulled.length} pushed=${result.pushed.length} conflicts=${result.conflicts.length}${result.error === null ? '' : ` error=${result.error.code}`}`)
    }
  }

  /** Give every newly materialized local plugin its manifest entry. */
  #registerLocalPlugins(result) {
    const names = new Set()
    for (const entry of result.pulled) {
      if (entry.item !== 'localPlugins' || entry.action !== 'write') continue
      const name = localPluginNameOfRepoPath(entry.path)
      if (name !== null) names.add(name)
    }
    if (names.size === 0) return
    try {
      const outcome = registerLocalPlugins(this.runtime, [...names])
      if (outcome.registered.length > 0) {
        result.localPluginsRegistered = outcome.registered
        result.localPluginsBackup = outcome.backup
        this.log(`registered local plugin(s): ${outcome.registered.join(', ')}`)
      }
    } catch (error) {
      result.warnings.push({
        repoPath: '',
        reason: 'local-plugin-register-failed',
        message: String(error?.message ?? error),
      })
    }
    this.invalideteInventory()
  }

  // --------------------------------------------------------------- conflicts

  /** Choose one side for one conflicted repository path. */
  async resolve(path, side) {
    if (this.running !== null) throw new SyncError('busy', 'wait for the running sync to finish')
    if (side !== 'local' && side !== 'remote') throw new SyncError('bad-request', 'side must be local or remote')
    const state = this.store.state
    const conflict = state.conflicts.find(entry => entry.path === path)
    if (conflict === undefined) throw new SyncError('not-conflicted', 'this path is not in the conflict list')
    const config = this.store.config
    const url = normalizeRepoUrl(config.repoUrl)
    const branch = await validateBranch(this.runtime, config.branch)
    const token = this.tokenInfo().token

    const promise = (async () => {
      try {
        this.phase = 'resolving'
        await prepareRepository(this.runtime, { url, branch, token })
        if (side === 'remote') {
          const remote = remoteInventory(this.runtime).files.get(path) ?? null
          const absolute = localPathFor(this.runtime, path)
          if (absolute === null) throw new SyncError('unmapped-path', 'cannot map this repository path to a local file')
          if (existsSync(absolute)) backupFiles(this.runtime, [{ repoPath: path, absolute }])
          if (remote === null) {
            removeFile(absolute)
          } else if (conflict.item === 'plugins') {
            const merged = mergeManifest(remote.buffer, absolute)
            writeLocalFile(absolute, merged, merged.length)
          } else {
            writeLocalFile(absolute, remote.buffer, remote.size)
          }
          accountBase(state.base, path, remote?.hash ?? null)
          if (remote !== null && (conflict.item === 'plugins' || conflict.item === 'lock' || conflict.item === 'localPlugins')) {
            state.pendingInstall = true
          }
          if (remote !== null && conflict.item === 'localPlugins') {
            const name = localPluginNameOfRepoPath(path)
            if (name !== null) {
              try {
                registerLocalPlugins(this.runtime, [name])
              } catch (error) {
                this.log(`local plugin registration failed: ${String(error?.message ?? error)}`)
              }
            }
          }
        } else {
          const local = localInventory(this.runtime).files.get(path) ?? null
          const repoPath = repoAbsolutePath(this.runtime, path)
          if (repoPath === null) throw new SyncError('unmapped-path', 'cannot map this repository path')
          const paths = [path]
          if (local === null) removeFile(repoPath)
          else writeLocalFile(repoPath, local.buffer, local.size)
          const message = `resolve(${this.runtime.profileName}): ${state.instanceId} keep local ${path}`
          const pushed = await commitAndPush(this.runtime, { branch, token, paths, message })
          accountBase(state.base, path, local?.hash ?? null)
          if (pushed.commit !== null) state.lastCommit = pushed.commit
        }
        state.conflicts = state.conflicts.filter(entry => entry.path !== path)
        if (state.lastResult !== null && typeof state.lastResult === 'object') {
          state.lastResult.conflicts = state.conflicts
        }
        return { path, side, remaining: state.conflicts.length }
      } finally {
        this.store.saveState()
      }
    })().finally(() => {
      this.running = null
      this.phase = null
      this.invalideteInventory()
    })
    this.running = promise
    return promise
  }

  // ----------------------------------------------------------------- install

  /** Install the pulled manifest with the host's package manager, else pnpm. */
  async install() {
    if (this.installState.running) throw new SyncError('install-busy', 'a dependency install is already running')
    const invocation = this.getPackageManager()
    const baseEnv = {
      ...this.env,
      CI: 'true',
      PATH: augmentedPath(this.env),
    }
    let command
    let args
    let env
    if (invocation !== null && typeof invocation.command === 'string' && invocation.command.trim() !== '') {
      command = invocation.command
      args = [...(Array.isArray(invocation.args) ? invocation.args : []), 'install', '--reporter=append-only']
      // The launcher's environment carries its bundled Node; our PATH carries
      // the tool directories. Merge rather than let either side erase the other.
      const hostEnv = invocation.env ?? {}
      const delimiter = process.platform === 'win32' ? ';' : ':'
      const pathParts = [
        ...String(hostEnv.PATH ?? '').split(delimiter),
        ...String(baseEnv.PATH ?? '').split(delimiter),
      ].filter(Boolean)
      env = { ...baseEnv, ...hostEnv, PATH: [...new Set(pathParts)].join(delimiter) }
    } else {
      command = 'pnpm'
      args = ['install', '--reporter=append-only']
      env = baseEnv
    }

    this.installState = { running: true, lastExitCode: null, lastOutput: '', at: new Date().toISOString() }
    this.phase = 'installing'
    try {
      this.log(`installing profile dependencies with ${command}`)
      const outcome = await runProcess(command, args, {
        cwd: this.runtime.profileDir,
        env,
        timeoutMs: INSTALL_TIMEOUT_MS,
      })
      this.installState = {
        running: false,
        lastExitCode: outcome.code,
        lastOutput: outcome.output.slice(-4000),
        at: new Date().toISOString(),
      }
      if (outcome.code === 0) {
        this.store.state.pendingInstall = false
        this.store.saveState()
      }
      if (outcome.timedOut) {
        return { ok: false, code: 'install-timeout', message: 'dependency install timed out', output: this.installState.lastOutput }
      }
      return {
        ok: outcome.code === 0,
        code: outcome.code === 0 ? 'installed' : 'install-failed',
        exitCode: outcome.code,
        output: this.installState.lastOutput,
      }
    } catch (error) {
      const failure = toFailure(error, 'install-failed')
      this.installState = { running: false, lastExitCode: 1, lastOutput: failure.message, at: new Date().toISOString() }
      return { ok: false, ...failure }
    } finally {
      this.phase = null
    }
  }

  /** Tear down the engine (the owner removes its timer). */
  dispose() {
    this.disposed = true
    this.inventoryCache = null
  }
}

/**
 * Make a pulled local plugin loadable on this machine.
 *
 * If the profile already links the package from a local directory, the pull
 * wrote the code there and nothing else is needed. Otherwise the managed copy
 * under `$DSH_HOME/harness-sync/local-plugins` becomes a `link:` dependency and,
 * when the package declares `dsh.bundle`, a profile bundle.
 */
function registerLocalPlugins(runtime, names) {
  const unique = [...new Set(names)].filter(name => typeof name === 'string' && isValidPackageName(name))
  if (unique.length === 0) return { registered: [], backup: null }
  const manifestPath = join(runtime.profileDir, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return { registered: [], backup: null }
  }
  if (!isPlainObject(manifest)) return { registered: [], backup: null }

  const dependencies = isPlainObject(manifest.dependencies) ? { ...manifest.dependencies } : {}
  const registered = []

  for (const name of unique) {
    const currentDir = resolveLocalDependencyDir(runtime, dependencies[name])
    if (currentDir !== null && existsSync(join(currentDir, 'package.json'))) continue
    const managed = managedLocalPluginDir(runtime, name)
    if (!existsSync(join(managed, 'package.json'))) continue
    dependencies[name] = `link:${managed.split(sep).join('/')}`
    registered.push(name)
  }

  if (registered.length === 0) return { registered: [], backup: null }
  // Deliberately dependency-only. Enabling a bundle is a separate, explicit act:
  // adding a bundle entry before its package is installed would make the next
  // Harness boot fail. The bootstrap install of this plugin already carries its
  // own bundle entry, and a newly pulled local plugin can be enabled in the
  // Plugins page.
  const next = { ...manifest, dependencies }
  const buffer = Buffer.from(`${JSON.stringify(next, null, 2)}\n`)
  const backup = backupFiles(runtime, [{
    repoPath: `${runtime.profileRepoPrefix}/package.json`,
    absolute: manifestPath,
  }])
  writeLocalFile(manifestPath, buffer, buffer.length)
  invalidateLocalPluginCache(runtime)
  return { registered, backup }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Keep the polled status small even after a sync touched thousands of files. */
function compactResult(result) {
  if (result === null || typeof result !== 'object') return null
  const pulled = Array.isArray(result.pulled) ? result.pulled : []
  const pushed = Array.isArray(result.pushed) ? result.pushed : []
  return {
    ...result,
    pulled: pulled.slice(0, 100),
    pushed: pushed.slice(0, 100),
    pulledTotal: typeof result.pulledTotal === 'number' ? result.pulledTotal : pulled.length,
    pushedTotal: typeof result.pushedTotal === 'number' ? result.pushedTotal : pushed.length,
    conflicts: Array.isArray(result.conflicts) ? result.conflicts : [],
  }
}

// ------------------------------------------------------------------ planning

/**
 * Compare the two sides against the saved base.
 *
 * Not exported for tests? It is: the algorithm is the part most worth pinning.
 */
export function planSync(runtime, localFiles, remoteFiles, base, config, mode) {
  const pulls = []
  const pushes = []
  const conflicts = []
  const resolved = []
  const skipped = []
  const unchanged = []
  const paths = new Set([...localFiles.keys(), ...remoteFiles.keys(), ...Object.keys(base)])

  for (const repoPath of paths) {
    const item = itemOfRepoPath(repoPath, runtime)
    if (item === null || config.items[item] !== true) continue
    const localEntry = localFiles.get(repoPath) ?? null
    const remoteEntry = remoteFiles.get(repoPath) ?? null
    const l = localEntry?.hash ?? null
    const r = remoteEntry?.hash ?? null
    const b = base[repoPath] ?? null

    // A profile without package.json cannot boot, so a deletion of the
    // manifest is never propagated. The side that still has it wins.
    if (item === 'plugins' && l !== r) {
      if (l !== null && r === null) {
        if (mode !== 'pull') {
          pushes.push({ repoPath, item, local: localEntry })
        } else {
          skipped.push({ path: repoPath, item, reason: 'manifest-delete-refused' })
        }
        continue
      }
      if (l === null && r !== null) {
        if (mode !== 'push') {
          pulls.push({ repoPath, item, remote: remoteEntry })
        } else {
          skipped.push({ path: repoPath, item, reason: 'manifest-delete-refused' })
        }
        continue
      }
    }

    if (l === r) {
      unchanged.push({ repoPath, item, hash: l })
      continue
    }
    const localChanged = l !== b
    const remoteChanged = r !== b

    if (localChanged && !remoteChanged) {
      if (mode !== 'pull') pushes.push({ repoPath, item, local: localEntry })
      else skipped.push({ path: repoPath, item, reason: 'local-change' })
      continue
    }
    if (!localChanged && remoteChanged) {
      if (mode !== 'push') pulls.push({ repoPath, item, remote: remoteEntry })
      else skipped.push({ path: repoPath, item, reason: 'remote-change' })
      continue
    }

    // Both sides changed (including "both are new with no base") and differ.
    const conflict = {
      path: repoPath,
      item,
      localHash: l,
      remoteHash: r,
      baseHash: b,
      localSize: localEntry?.size ?? 0,
      remoteSize: remoteEntry?.size ?? 0,
    }
    if (config.conflictMode === 'remote' && mode !== 'push') {
      pulls.push({ repoPath, item, remote: remoteEntry })
      resolved.push({ ...conflict, side: 'remote' })
    } else if (config.conflictMode === 'local' && mode !== 'pull') {
      pushes.push({ repoPath, item, local: localEntry })
      resolved.push({ ...conflict, side: 'local' })
    } else {
      conflicts.push(conflict)
    }
  }

  unchanged.sort((a, b) => a.repoPath.localeCompare(b.repoPath))
  return { pulls, pushes, conflicts, resolved, skipped, unchanged }
}

function accountBase(base, repoPath, hash) {
  if (hash === null || hash === undefined || hash === '') delete base[repoPath]
  else base[repoPath] = hash
}

// ---------------------------------------------------------------- file work

function writeLocalFile(absolute, buffer, size) {
  mkdirSync(dirname(absolute), { recursive: true })
  let mode = 0o644
  try {
    if (existsSync(absolute)) mode = statSync(absolute).mode & 0o777
  } catch {
    // keep the default mode
  }
  if (typeof size === 'number' && size > buffer.length) {
    // Defensive: a truncated read is never written over a good file.
    throw new SyncError('read-truncated', `refusing to write a truncated file (${absolute})`)
  }
  const temporary = `${absolute}.hs-tmp-${process.pid}`
  try {
    writeFileSync(temporary, buffer, { mode })
    renameSync(temporary, absolute)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // best effort
    }
    try {
      writeFileSync(absolute, buffer, { mode })
    } catch {
      throw new SyncError('write-failed', `cannot write ${absolute}: ${String(error?.message ?? error)}`)
    }
  }
}

function removeFile(absolute) {
  try {
    unlinkSync(absolute)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new SyncError('write-failed', `cannot delete ${absolute}: ${String(error?.message ?? error)}`)
    }
  }
}

function repoAbsolutePath(runtime, repoPath) {
  const segments = repoPath.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null
  const absolute = resolve(runtime.repoDir, ...segments)
  if (absolute !== runtime.repoDir && !absolute.startsWith(`${runtime.repoDir}${sep}`)) return null
  return absolute
}

function backupFiles(runtime, targets) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const directory = join(runtime.backupDir, stamp)
    let copied = 0
    for (const target of targets) {
      if (target.absolute === null || !existsSync(target.absolute)) continue
      const destination = join(directory, ...target.repoPath.split('/'))
      mkdirSync(dirname(destination), { recursive: true })
      let data
      try {
        data = readFileSync(target.absolute)
      } catch {
        continue
      }
      writeFileSync(destination, data)
      copied += 1
    }
    pruneBackups(runtime)
    return copied > 0 ? stamp : null
  } catch (error) {
    // A backup failure must not eat the user's data: abort the sync instead.
    throw new SyncError('backup-failed', `cannot back up files before overwriting them: ${String(error?.message ?? error)}`)
  }
}

function pruneBackups(runtime) {
  try {
    const entries = readdirSync(runtime.backupDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    for (const name of entries.slice(0, Math.max(0, entries.length - MAX_BACKUPS))) {
      rmSync(join(runtime.backupDir, name), { recursive: true, force: true })
    }
  } catch {
    // Backup pruning is cosmetic.
  }
}

function augmentedPath(env) {
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const home = env.HOME ?? env.USERPROFILE ?? ''
  const candidates = [
    env.PNPM_HOME,
    process.platform === 'win32' ? undefined : '/opt/homebrew/bin',
    process.platform === 'win32' ? undefined : '/usr/local/bin',
    process.platform === 'win32' ? undefined : join(home, '.local', 'bin'),
    process.platform === 'win32' ? undefined : join(home, 'Library', 'pnpm'),
    process.platform === 'win32' ? undefined : join(home, '.local', 'share', 'pnpm'),
    process.platform === 'win32' && env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'pnpm') : undefined,
  ].filter(value => typeof value === 'string' && value !== '')
  const parts = [...candidates, ...(env.PATH ?? '').split(delimiter).filter(Boolean)]
  return [...new Set(parts)].join(delimiter)
}

function runProcess(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolvePromise) => {
    let child
    const chunks = []
    let settled = false
    let timer
    const collect = (chunk) => {
      chunks.push(String(chunk))
      if (chunks.join('').length > 200_000) chunks.splice(0, chunks.length - 40)
    }
    const finish = (code, timedOut) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolvePromise({ code, timedOut, output: chunks.join('').slice(-40_000) })
    }
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        shell: process.platform === 'win32' && /(^|[\\/])pnpm(\.cmd)?$/i.test(command),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group, so a timeout also stops the package manager's
        // children instead of leaving a grandchild install running.
        detached: process.platform !== 'win32',
      })
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      timer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && typeof child.pid === 'number') process.kill(-child.pid, 'SIGTERM')
          else child.kill('SIGTERM')
        } catch {
          try {
            child.kill('SIGTERM')
          } catch {
            // The process may already be gone.
          }
        }
        finish(124, true)
      }, timeoutMs)
      child.on('error', (error) => {
        chunks.push(String(error?.message ?? error))
        finish(127, false)
      })
      child.on('close', (code) => finish(typeof code === 'number' ? code : 1, false))
    } catch (error) {
      chunks.push(String(error?.message ?? error))
      finish(127, false)
    }
  })
}

// Re-exported so the Host entry point does not need a second import graph.
export { ITEM_DEFINITIONS, ITEM_IDS }
