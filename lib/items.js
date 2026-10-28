/**
 * The syncable items and what they mean on disk.
 *
 * An item is a named slice of the profile or of the skill library. The same
 * mapping is used in both directions, so a repository path always resolves to
 * exactly one local file and one item.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { expandHomePath } from './paths.js'

export const ITEM_DEFINITIONS = Object.freeze([
  { id: 'plugins', defaultOn: true, secretRisk: false },
  { id: 'localPlugins', defaultOn: true, secretRisk: false },
  { id: 'pluginConfig', defaultOn: true, secretRisk: false },
  { id: 'pluginData', defaultOn: true, secretRisk: false },
  { id: 'lock', defaultOn: true, secretRisk: false },
  { id: 'profileFiles', defaultOn: false, secretRisk: true },
  { id: 'skills', defaultOn: false, secretRisk: false },
])

export const ITEM_IDS = ITEM_DEFINITIONS.map(item => item.id)

/** Files owned by an explicit item, never by the catch-all profile item. */
const MANAGED_PROFILE_FILES = new Set([
  'package.json',
  'cordis.patch.yml',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'cordis.yml',
])

/** A file name that routinely carries a credential; never synced. */
const SECRET_NAME = [
  /^\.env(\..*)?$/i,
  /credential/i,
  /secret/i,
  /^id_(rsa|ed25519|ecdsa|dsa)/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^config\.toml$/i,
  /^auth\.json$/i,
]

/** A dependency spec that points at this machine's filesystem. */
const LOCAL_SPEC = /^(?:link:|file:|portal:|workspace:|\.{1,2}[\\/]|~[\\/]|[\\/]|[A-Za-z]:[\\/])/

/** One file larger than this is skipped with a warning instead of synced. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_PROFILE_DEPTH = 6
const MAX_SKILL_DEPTH = 12

export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function isSecretName(name) {
  return SECRET_NAME.some(pattern => pattern.test(name))
}

function isSkippableDir(name) {
  return name === 'node_modules' || name === '.git' || name === '.DS_Store' || name.startsWith('.')
}

function walk(root, depth, maxDepth, onFile) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const absolute = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (isSkippableDir(entry.name) || depth >= maxDepth) continue
      walk(absolute, depth + 1, maxDepth, onFile)
      continue
    }
    if (!entry.isFile() || entry.name === '.DS_Store') continue
    onFile(absolute, entry.name)
  }
}

function readEntry(item, repoPath, absolute, transform) {
  const stat = lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink()) return null
  if (stat.size > MAX_FILE_BYTES) {
    return { skipped: { repoPath, reason: 'too-large', size: stat.size } }
  }
  const raw = readFileSync(absolute)
  // The sync form of a machine-local manifest/lockfile strips absolute link
  // specs; the raw file on disk keeps them.
  const buffer = typeof transform === 'function' ? transform(raw) : raw
  return {
    entry: {
      repoPath,
      absPath: absolute,
      hash: hashBuffer(buffer),
      buffer,
      size: buffer.length,
      mtimeMs: stat.mtimeMs,
      item,
    },
  }
}

/** Repository directory holding machine-local plugin sources. */
export const LOCAL_PLUGIN_ROOT = 'local-plugins'

/** This plugin's own package name; excluded from local-plugin sync by default. */
export const SELF_PLUGIN_NAME = 'dsh-anywhere-sync'

/** Repository directory holding plugin-owned configuration files. */
export const PLUGIN_DATA_ROOT = 'plugin-data'

/**
 * Plugin-owned config files that are safe to carry between machines.
 *
 * dsh-whale-widget keeps its appearance/bubble/custom-API settings in these
 * three files. Its accounting ledger (`.dshw-usage.json`), per-turn sequence
 * and stats caches are data, not configuration, and are intentionally absent.
 */
export const DEFAULT_PLUGIN_DATA_PATHS = Object.freeze([
  '.dshw-size.json',
  '.dshw-bubble.json',
  '.dshw-api.json',
])

/** Path segments that must never be carried by the plugin-data item. */
const PLUGIN_DATA_SENSITIVE = /^(?:credential|credentials|secret|secrets|token|tokens|password|passwords|auth|anywhere-sync|profiles|storages|sessions|node_modules|\.git)$/i

/** Normalize one plugin-data path; null means invalid/unsafe. */
export function normalizePluginDataPath(value) {
  if (typeof value !== 'string') return null
  let path = value.trim().replace(/\\/g, '/')
  if (path === '' || path.length > 240) return null
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null
  const directory = path.endsWith('/')
  path = path.replace(/^\.\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '')
  if (path === '' || path.startsWith('~') || path.includes('\0')) return null
  const segments = path.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null
  if (segments.some(segment => isSecretName(segment) || PLUGIN_DATA_SENSITIVE.test(segment))) return null
  return directory ? `${path}/` : path
}

/** Normalize a user-supplied list; absent means the curated defaults. */
export function normalizePluginDataPaths(value) {
  if (!Array.isArray(value)) return [...DEFAULT_PLUGIN_DATA_PATHS]
  const paths = []
  for (const candidate of value.slice(0, 50)) {
    const path = normalizePluginDataPath(candidate)
    if (path !== null && !paths.includes(path)) paths.push(path)
  }
  return paths
}

/** A valid npm package name we are willing to use as a repository segment. */
export function isValidPackageName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 214) return false
  if (name.includes('..')) return false
  return /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
}

/** One repository segment for a package name (`@scope/name` included). */
export function encodeLocalPluginName(name) {
  return encodeURIComponent(name)
}

function decodeLocalPluginSegment(segment) {
  try {
    const name = decodeURIComponent(segment)
    return isValidPackageName(name) ? name : null
  } catch {
    return null
  }
}

/** The package whose source owns one `local-plugins/...` repository path. */
export function localPluginNameOfRepoPath(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath.startsWith(`${LOCAL_PLUGIN_ROOT}/`)) return null
  const parts = repoPath.split('/')
  return parts.length >= 2 ? decodeLocalPluginSegment(parts[1]) : null
}

/** Where a pulled copy of a local plugin lives when this machine has none. */
export function managedLocalPluginDir(runtime, name) {
  return join(runtime.syncDir, LOCAL_PLUGIN_ROOT, encodeLocalPluginName(name))
}

/** Resolve a `link:`/`file:`/`portal:`/bare-path spec to its directory. */
export function resolveLocalDependencyDir(runtime, spec) {
  if (typeof spec !== 'string') return null
  const raw = spec.trim()
  let value = null
  for (const prefix of ['link:', 'file:', 'portal:']) {
    if (raw.startsWith(prefix)) {
      value = raw.slice(prefix.length)
      break
    }
  }
  if (value === null) {
    if (!/^(?:\.{1,2}[\\/]|~[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(raw)) return null
    value = raw
  }
  if (value === '') return null
  const expanded = expandHomePath(value)
  return isAbsolute(expanded) ? expanded : resolve(runtime.profileDir, expanded)
}

const localPluginCache = new WeakMap()

/**
 * Every machine-local plugin this profile has source for.
 *
 * The manifest's local specs win (that is the path the user installed from);
 * managed copies pulled from the repository fill in packages this machine has
 * never installed before. `node_modules` and hidden directories are excluded by
 * the shared walker.
 */
export function localPluginDirectories(runtime, options = {}) {
  const force = options.force === true
  const excludeSelf = options.excludeSelf === true
  const cached = localPluginCache.get(runtime)
  if (!force && cached !== undefined && Date.now() - cached.at < 2_000) {
    return excludeSelf ? withoutSelf(cached.directories) : cached.directories
  }
  const directories = new Map()
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(runtime.profileDir, 'package.json'), 'utf8'))
  } catch {
    manifest = null
  }
  if (manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)) {
    const dependencies = manifest.dependencies !== null && typeof manifest.dependencies === 'object' && !Array.isArray(manifest.dependencies)
      ? manifest.dependencies
      : {}
    for (const [name, spec] of Object.entries(dependencies)) {
      if (!isValidPackageName(name)) continue
      const directory = resolveLocalDependencyDir(runtime, spec)
      if (directory !== null && existsSync(join(directory, 'package.json'))) directories.set(name, directory)
    }
  }
  const managedRoot = join(runtime.syncDir, LOCAL_PLUGIN_ROOT)
  try {
    for (const entry of readdirSync(managedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const name = decodeLocalPluginSegment(entry.name)
      if (name === null || directories.has(name)) continue
      const directory = join(managedRoot, entry.name)
      if (existsSync(join(directory, 'package.json'))) directories.set(name, directory)
    }
  } catch {
    // No managed directory yet.
  }
  localPluginCache.set(runtime, { at: Date.now(), directories })
  return excludeSelf ? withoutSelf(directories) : directories
}

/** Remove this plugin's own source from a discovered local-plugin map. */
function withoutSelf(directories) {
  if (!directories.has(SELF_PLUGIN_NAME)) return directories
  const copy = new Map(directories)
  copy.delete(SELF_PLUGIN_NAME)
  return copy
}

/** Drop the discovery cache after a manifest change or a pull. */
export function invalidateLocalPluginCache(runtime) {
  localPluginCache.delete(runtime)
}

/**
 * The portable form of a profile manifest: machine-local dependency specs are
 * removed before it is compared or pushed.
 *
 * A `link:`/`file:` dependency names a path on ONE machine. Publishing it
 * would make every other machine's install point at a path that does not
 * exist there, and for this plugin itself the local link is exactly how it is
 * installed. The raw manifest on disk is never modified; only the synced
 * projection is.
 */
export function toPortableManifest(buffer) {
  let manifest
  try {
    manifest = JSON.parse(buffer.toString('utf8'))
  } catch {
    // A malformed manifest is skipped (and reported) rather than published;
    // the other machine then heals the repository from its own valid file.
    throw new Error('package.json is not valid JSON')
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('package.json is not a JSON object')
  }
  const dependencies = isPlainObject(manifest.dependencies) ? { ...manifest.dependencies } : {}
  const localNames = new Set()
  for (const [name, spec] of Object.entries(dependencies)) {
    if (isLocalSpec(spec)) {
      localNames.add(name)
      delete dependencies[name]
    }
  }
  const portable = { ...manifest, dependencies }
  if (isPlainObject(manifest.dsh)) {
    const dsh = { ...manifest.dsh }
    if (isPlainObject(dsh.profile)) {
      const profile = { ...dsh.profile }
      if (Array.isArray(profile.bundles)) {
        profile.bundles = profile.bundles.filter(name => typeof name === 'string' && !localNames.has(name))
      }
      dsh.profile = profile
    }
    portable.dsh = dsh
  }
  return Buffer.from(`${JSON.stringify(portable, null, 2)}\n`)
}

/** True when a dependency spec names a path on this machine. */
export function isLocalSpec(value) {
  return typeof value === 'string' && LOCAL_SPEC.test(value.trim())
}

/**
 * The portable form of `pnpm-lock.yaml`: importer blocks whose specifier or
 * version is a local path are removed.
 *
 * pnpm writes a `link:` block for every machine-local dependency. The block is
 * meaningless on another machine and can make its install fail. The local
 * lockfile keeps the block; on pull the package manager restores it from the
 * (merged) local manifest on the next install.
 */
export function toPortableLock(buffer) {
  const text = buffer.toString('utf8')
  if (!/^\s*(?:specifier|version):\s*\S/m.test(text)) return buffer
  const hasLocal = text.split('\n').some(line => {
    const match = /^\s*(?:specifier|version):\s*(.+)$/.exec(line)
    return match !== null && isLocalSpec(unquote(match[1]))
  })
  if (!hasLocal) return buffer

  const lines = text.split('\n')
  const output = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const header = /^( {6})([^#\s][^:]*):\s*$/.exec(line)
    if (header === null) {
      output.push(line)
      index += 1
      continue
    }
    let end = index + 1
    while (end < lines.length) {
      const next = lines[end]
      if (next.trim() !== '' && indentOf(next) <= 6) break
      end += 1
    }
    const block = lines.slice(index + 1, end)
    const local = block.some(entry => {
      const match = /^\s*(?:specifier|version):\s*(.+)$/.exec(entry)
      return match !== null && isLocalSpec(unquote(match[1]))
    })
    if (!local) output.push(...lines.slice(index, end))
    index = end
  }
  const collapsed = output.join('\n')
  return Buffer.from(text.endsWith('\n') && !collapsed.endsWith('\n') ? `${collapsed}\n` : collapsed)
}

/**
 * Re-apply this machine's local dependency specs to a remote manifest.
 *
 * The remote side intentionally has no local specs; the local manifest still
 * has them (this plugin's own `link:` among them). A pull therefore merges
 * instead of overwriting.
 */
export function mergeManifest(remoteBuffer, localAbsolute) {
  let remote
  try {
    remote = JSON.parse(remoteBuffer.toString('utf8'))
  } catch {
    return remoteBuffer
  }
  if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) return remoteBuffer
  let local
  try {
    local = JSON.parse(readFileSync(localAbsolute, 'utf8'))
  } catch {
    return remoteBuffer
  }
  if (local === null || typeof local !== 'object' || Array.isArray(local)) return remoteBuffer

  const localDependencies = isPlainObject(local.dependencies) ? local.dependencies : {}
  const localNames = Object.keys(localDependencies).filter(name => isLocalSpec(localDependencies[name]))
  const dependencies = isPlainObject(remote.dependencies) ? { ...remote.dependencies } : {}
  for (const name of localNames) dependencies[name] = localDependencies[name]

  const merged = { ...local, ...remote, dependencies }
  const localDsh = isPlainObject(local.dsh) ? local.dsh : {}
  const remoteDsh = isPlainObject(remote.dsh) ? remote.dsh : {}
  const localProfile = isPlainObject(localDsh.profile) ? localDsh.profile : {}
  const remoteProfile = isPlainObject(remoteDsh.profile) ? remoteDsh.profile : {}
  const bundles = Array.isArray(remoteProfile.bundles) ? [...remoteProfile.bundles] : []
  if (Array.isArray(localProfile.bundles)) {
    for (const name of localProfile.bundles) {
      if (localNames.includes(name) && !bundles.includes(name)) bundles.push(name)
    }
  }
  merged.dsh = { ...localDsh, ...remoteDsh, profile: { ...localProfile, ...remoteProfile, bundles } }
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`)
}

function portableTransformFor(runtime, repoPath) {
  const prefix = `${runtime.profileRepoPrefix}/`
  if (repoPath === `${prefix}package.json`) return toPortableManifest
  if (repoPath === `${prefix}pnpm-lock.yaml`) return toPortableLock
  return undefined
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function indentOf(line) {
  let count = 0
  while (count < line.length && line[count] === ' ') count += 1
  return count
}

function unquote(value) {
  const raw = String(value).trim()
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1)
  }
  return raw
}

/**
 * Every local file the plugin knows about, for every item.
 *
 * Files of disabled items are still listed (the UI shows their size), but only
 * selected items take part in a sync. Symlinks and oversized files are skipped
 * and reported, never followed.
 */
export function localInventory(runtime, options = {}) {
  const files = new Map()
  const warnings = []
  const counts = Object.fromEntries(ITEM_IDS.map(id => [id, 0]))
  const skippedSecrets = []

  const add = (item, repoPath, absolute, transform) => {
    let result
    try {
      result = readEntry(item, repoPath, absolute, transform)
    } catch (error) {
      warnings.push({ repoPath, reason: 'unreadable', message: String(error?.message ?? error) })
      return
    }
    if (result === null) return
    if (result.skipped !== undefined) {
      warnings.push(result.skipped)
      return
    }
    files.set(repoPath, result.entry)
    counts[item] += 1
  }

  const prefix = runtime.profileRepoPrefix
  add('plugins', `${prefix}/package.json`, join(runtime.profileDir, 'package.json'), toPortableManifest)
  add('pluginConfig', `${prefix}/cordis.patch.yml`, join(runtime.profileDir, 'cordis.patch.yml'))
  add('lock', `${prefix}/pnpm-lock.yaml`, join(runtime.profileDir, 'pnpm-lock.yaml'), toPortableLock)
  add('lock', `${prefix}/pnpm-workspace.yaml`, join(runtime.profileDir, 'pnpm-workspace.yaml'))

  const extraRoots = [runtime.profileDir]
  for (const root of extraRoots) {
    walk(root, 0, MAX_PROFILE_DEPTH, (absolute, name) => {
      const rel = relative(runtime.profileDir, absolute).split(sep).join('/')
      if (rel === '' || rel.startsWith('../')) return
      if (MANAGED_PROFILE_FILES.has(name)) return
      if (/\.bak\b/.test(name)) return
      if (isSecretName(name)) {
        skippedSecrets.push({ repoPath: `${prefix}/${rel}`, item: 'profileFiles' })
        if (skippedSecrets.length <= 50) {
          warnings.push({ repoPath: `${prefix}/${rel}`, reason: 'secret-excluded' })
        }
        return
      }
      add('profileFiles', `${prefix}/${rel}`, absolute)
    })
  }

  walk(runtime.skillsRoot, 0, MAX_SKILL_DEPTH, (absolute) => {
    const rel = relative(runtime.skillsRoot, absolute).split(sep).join('/')
    if (rel === '' || rel.startsWith('../')) return
    add('skills', `skills/${rel}`, absolute)
  })

  add('skills', 'skills/.skill-lock.json', runtime.skillsLockPath)

  // Plugin-owned configuration files. Explicit paths keep the item predictable;
  // a trailing slash means "walk this directory". Missing defaults are normal.
  const pluginDataPaths = Array.isArray(options.pluginDataPaths) ? options.pluginDataPaths : DEFAULT_PLUGIN_DATA_PATHS
  for (const candidate of pluginDataPaths) {
    const path = normalizePluginDataPath(candidate)
    if (path === null) continue
    const directory = path.endsWith('/')
    const rel = path.replace(/\/+$/, '')
    const absolute = join(runtime.dshHome, ...rel.split('/'))
    if (directory) {
      walk(absolute, 0, 12, (file, fileName) => {
        const sub = relative(runtime.dshHome, file).split(sep).join('/')
        if (sub === '' || sub.startsWith('../')) return
        if (isSecretName(fileName)) {
          if (warnings.length < 100) warnings.push({ repoPath: `${PLUGIN_DATA_ROOT}/${sub}`, reason: 'secret-excluded' })
          return
        }
        add('pluginData', `${PLUGIN_DATA_ROOT}/${sub}`, file)
      })
    } else if (existsSync(absolute)) {
      add('pluginData', `${PLUGIN_DATA_ROOT}/${rel}`, absolute)
    }
  }

  // Machine-local plugin sources (link:/file: dependencies), e.g. this plugin
  // itself. The repository carries the code; the manifest projection stays
  // machine-neutral and the pull side registers a local link again.
  for (const [name, directory] of localPluginDirectories(runtime, { excludeSelf: options.excludeSelf === true })) {
    const encoded = encodeLocalPluginName(name)
    walk(directory, 0, 12, (absolute, fileName) => {
      const rel = relative(directory, absolute).split(sep).join('/')
      if (rel === '' || rel.startsWith('../')) return
      const repoPath = `${LOCAL_PLUGIN_ROOT}/${encoded}/${rel}`
      if (isSecretName(fileName)) {
        if (warnings.length < 100) warnings.push({ repoPath, reason: 'secret-excluded' })
        return
      }
      add('localPlugins', repoPath, absolute)
    })
  }

  return { files, warnings, counts, skippedSecrets }
}

/** Which item owns one repository path, or null when the path is not ours. */
export function itemOfRepoPath(repoPath, runtime) {
  const prefix = `${runtime.profileRepoPrefix}/`
  if (repoPath.startsWith(prefix)) {
    const rest = repoPath.slice(prefix.length)
    if (rest === 'package.json') return 'plugins'
    if (rest === 'cordis.patch.yml') return 'pluginConfig'
    if (rest === 'pnpm-lock.yaml' || rest === 'pnpm-workspace.yaml') return 'lock'
    const name = basename(rest)
    if (MANAGED_PROFILE_FILES.has(name)) return null
    if (/\.bak\b/.test(name)) return null
    if (isSecretName(name)) return null
    return 'profileFiles'
  }
  if (repoPath.startsWith(`${PLUGIN_DATA_ROOT}/`)) {
    const rest = repoPath.slice(PLUGIN_DATA_ROOT.length + 1)
    return normalizePluginDataPath(rest) === rest ? 'pluginData' : null
  }
  if (repoPath === 'skills/.skill-lock.json') return 'skills'
  if (repoPath.startsWith('skills/')) return 'skills'
  if (repoPath.startsWith(`${LOCAL_PLUGIN_ROOT}/`)) {
    return localPluginNameOfRepoPath(repoPath) === null ? null : 'localPlugins'
  }
  return null
}

/** Read the repository working tree into the same shape as the local side. */
export function remoteInventory(runtime, options = {}) {
  const files = new Map()
  const warnings = []
  const counts = Object.fromEntries(ITEM_IDS.map(id => [id, 0]))

  walk(runtime.repoDir, 0, 12, (absolute) => {
    const repoPath = relative(runtime.repoDir, absolute).split(sep).join('/')
    if (repoPath === '' || repoPath.startsWith('../')) return
    const item = itemOfRepoPath(repoPath, runtime)
    if (item === null) return
    if (item === 'localPlugins' && options.excludeSelf === true && localPluginNameOfRepoPath(repoPath) === SELF_PLUGIN_NAME) return
    let result
    try {
      result = readEntry(item, repoPath, absolute, portableTransformFor(runtime, repoPath))
    } catch (error) {
      warnings.push({ repoPath, reason: 'unreadable', message: String(error?.message ?? error) })
      return
    }
    if (result === null) return
    if (result.skipped !== undefined) {
      warnings.push(result.skipped)
      return
    }
    files.set(repoPath, { ...result.entry, absPath: null })
    counts[item] += 1
  }, () => {})

  return { files, warnings, counts }
}

/** The subset of an inventory that takes part in this sync. */
export function selectedFiles(files, config) {
  const selected = new Map()
  for (const [repoPath, entry] of files) {
    if (config.items[entry.item] === true) selected.set(repoPath, entry)
  }
  return selected
}

/** Resolve a repository path back to the local file it mirrors. */
export function localPathFor(runtime, repoPath) {
  if (typeof repoPath !== 'string' || repoPath === '') return null
  const segments = repoPath.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return null

  if (repoPath.startsWith(`${LOCAL_PLUGIN_ROOT}/`)) {
    const parts = repoPath.split('/')
    if (parts.length < 3) return null
    const name = decodeLocalPluginSegment(parts[1])
    if (name === null) return null
    const root = localPluginDirectories(runtime).get(name)
      ?? join(runtime.syncDir, LOCAL_PLUGIN_ROOT, parts[1])
    const absolute = resolve(root, ...parts.slice(2))
    return isInside(root, absolute) ? absolute : null
  }
  if (repoPath.startsWith(`${PLUGIN_DATA_ROOT}/`)) {
    const rest = repoPath.slice(PLUGIN_DATA_ROOT.length + 1)
    if (normalizePluginDataPath(rest) !== rest) return null
    const absolute = resolve(runtime.dshHome, ...rest.split('/'))
    return isInside(runtime.dshHome, absolute) ? absolute : null
  }
  if (repoPath === 'skills/.skill-lock.json') return runtime.skillsLockPath
  if (repoPath.startsWith('skills/')) {
    const absolute = resolve(runtime.skillsRoot, ...repoPath.slice('skills/'.length).split('/'))
    return isInside(runtime.skillsRoot, absolute) ? absolute : null
  }
  const prefix = `${runtime.profileRepoPrefix}/`
  if (repoPath.startsWith(prefix)) {
    const absolute = resolve(runtime.profileDir, ...repoPath.slice(prefix.length).split('/'))
    return isInside(runtime.profileDir, absolute) ? absolute : null
  }
  return null
}

function isInside(root, candidate) {
  const base = resolve(root)
  const value = resolve(candidate)
  return value === base || value.startsWith(`${base}${sep}`)
}

/** A stable, user-facing path label (never an absolute local path). */
export function displayPath(repoPath) {
  return repoPath
}

/** The smallest common prefix of a set of repository paths, for UI grouping. */
export function fileSummary(entries) {
  return entries
    .slice()
    .sort((a, b) => a.repoPath.localeCompare(b.repoPath))
    .map(entry => ({ path: displayPath(entry.repoPath), size: entry.size ?? 0 }))
}

/** True when an absolute path is a regular file the plugin may write. */
export function isWritableFilePath(absolute) {
  return typeof absolute === 'string' && isAbsolute(absolute)
}
