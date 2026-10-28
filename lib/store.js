/**
 * Durable plugin state: sync configuration, the per-file base hashes that
 * make three-way comparison possible, and the token.
 *
 * The token never enters `config.json` or `state.json`: both are surfaced to
 * the browser, while `credentials.json` is only ever read by the Host and is
 * written with mode 0600.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname } from 'node:path'

export const ITEM_IDS = ['plugins', 'localPlugins', 'pluginConfig', 'lock', 'profileFiles', 'skills']
export const CONFLICT_MODES = ['remote', 'local', 'skip']

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  repoUrl: '',
  branch: 'main',
  items: Object.freeze({
    plugins: true,
    localPlugins: true,
    pluginConfig: true,
    lock: true,
    profileFiles: false,
    skills: false,
  }),
  autoSync: false,
  intervalMinutes: 15,
  syncOnStartup: true,
  autoInstall: true,
  excludeSelf: true,
  conflictMode: 'remote',
})

export const DEFAULT_STATE = Object.freeze({
  version: 1,
  instanceId: '',
  base: {},
  lastSyncAt: null,
  lastCommit: null,
  lastResult: null,
  conflicts: [],
  pendingInstall: false,
  history: [],
})

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Atomic 0600 write; a torn write can never leave a half-written state file. */
export function writeJsonSecure(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(temporary, 0o600)
  } catch {
    // Non-POSIX platforms do not implement chmod; the mode above still applies.
  }
  renameSync(temporary, path)
}

export function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

export function asInteger(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Merge untrusted JSON onto the defaults, dropping anything unknown. */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rawItems = source.items !== null && typeof source.items === 'object' && !Array.isArray(source.items) ? source.items : {}
  const items = {}
  for (const id of ITEM_IDS) items[id] = asBoolean(rawItems[id], DEFAULT_CONFIG.items[id])
  return {
    version: 1,
    repoUrl: asString(source.repoUrl).trim().slice(0, 500),
    branch: asString(source.branch, DEFAULT_CONFIG.branch).trim().slice(0, 200) || DEFAULT_CONFIG.branch,
    items,
    autoSync: asBoolean(source.autoSync, DEFAULT_CONFIG.autoSync),
    intervalMinutes: asInteger(source.intervalMinutes, DEFAULT_CONFIG.intervalMinutes, 1, 1440),
    syncOnStartup: asBoolean(source.syncOnStartup, DEFAULT_CONFIG.syncOnStartup),
    autoInstall: asBoolean(source.autoInstall, DEFAULT_CONFIG.autoInstall),
    excludeSelf: asBoolean(source.excludeSelf, DEFAULT_CONFIG.excludeSelf),
    conflictMode: CONFLICT_MODES.includes(source.conflictMode) ? source.conflictMode : DEFAULT_CONFIG.conflictMode,
  }
}

/** Merge untrusted state onto the defaults; `base` is always a string map. */
export function normalizeState(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const rawBase = source.base !== null && typeof source.base === 'object' && !Array.isArray(source.base) ? source.base : {}
  const base = {}
  for (const [path, hash] of Object.entries(rawBase)) {
    if (typeof path === 'string' && typeof hash === 'string' && hash !== '') base[path] = hash
  }
  const history = Array.isArray(source.history)
    ? source.history.filter(entry => entry !== null && typeof entry === 'object').slice(-20)
    : []
  return {
    version: 1,
    instanceId: asString(source.instanceId),
    base,
    lastSyncAt: typeof source.lastSyncAt === 'string' ? source.lastSyncAt : null,
    lastCommit: typeof source.lastCommit === 'string' ? source.lastCommit : null,
    lastResult: source.lastResult !== null && typeof source.lastResult === 'object' ? source.lastResult : null,
    conflicts: Array.isArray(source.conflicts) ? source.conflicts.filter(entry => entry !== null && typeof entry === 'object') : [],
    pendingInstall: asBoolean(source.pendingInstall, false),
    history,
  }
}

/** All files the plugin owns, loaded once per activation. */
export class SyncStore {
  constructor(runtime) {
    this.runtime = runtime
    mkdirSync(runtime.syncDir, { recursive: true })
    this.config = normalizeConfig(readJson(runtime.configPath))
    this.state = normalizeState(readJson(runtime.statePath))
    if (this.state.instanceId === '') {
      this.state.instanceId = makeInstanceId()
      this.saveState()
    }
  }

  get token() {
    const raw = readJson(this.runtime.credentialsPath)
    return raw !== null && typeof raw === 'object' && typeof raw.token === 'string' ? raw.token : ''
  }

  set token(value) {
    const token = typeof value === 'string' ? value.trim() : ''
    if (token === '') {
      if (existsSync(this.runtime.credentialsPath)) writeJsonSecure(this.runtime.credentialsPath, { token: '' })
      return
    }
    writeJsonSecure(this.runtime.credentialsPath, { token })
  }

  saveConfig(next) {
    this.config = normalizeConfig(next)
    writeJsonSecure(this.runtime.configPath, this.config)
    return this.config
  }

  saveState() {
    writeJsonSecure(this.runtime.statePath, this.state)
    return this.state
  }

  pushHistory(entry) {
    this.state.history = [...(this.state.history ?? []), entry].slice(-20)
    this.saveState()
  }
}

function makeInstanceId() {
  const host = safeHostname()
  const random = Math.random().toString(36).slice(2, 8)
  return `${host}-${random}`
}

function safeHostname() {
  try {
    const name = hostname() || process.env.COMPUTERNAME || process.env.HOSTNAME || ''
    if (name !== '') return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)
  } catch {
    // Fall through to the stable placeholder.
  }
  return 'machine'
}
