/**
 * Local, offline verification of the sync engine against a bare git repository.
 * Not part of the shipped plugin; run with `node scripts/engine-test.mjs`.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SyncEngine } from '../lib/engine.js'
import { createRuntime } from '../lib/paths.js'

const root = new URL('..', import.meta.url).pathname
const sandbox = join(root, '.engine-test')
const home = join(sandbox, 'home')
const profile = join(home, 'profiles', 'desktop')
const skills = join(home, '.agents', 'skills')
const remote = join(sandbox, 'remote.git')
const reader = join(sandbox, 'reader')

rmSync(sandbox, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
mkdirSync(join(skills, 'lark-demo'), { recursive: true })
mkdirSync(join(home, '.agents'), { recursive: true })

function write(path, text) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

// A machine-local plugin package, linked from the profile like this plugin is.
const localPlugin = join(sandbox, 'local-plugin')
mkdirSync(join(localPlugin, 'node_modules', 'ignored'), { recursive: true })
write(join(localPlugin, 'package.json'), JSON.stringify({
  name: 'test-local-plugin',
  version: '1.0.0',
  type: 'module',
  exports: { '.': './index.js' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}, null, 2))
write(join(localPlugin, 'index.js'), 'export function apply() {}\n')
write(join(localPlugin, 'cordis.patch.yml'), "- insert:\n    - id: test-local-plugin\n      name: test-local-plugin\n")
write(join(localPlugin, 'node_modules', 'ignored', 'index.js'), 'must never sync\n')
write(join(localPlugin, '.env'), 'SECRET=must-never-sync\n')

const manifest = (extraDeps = {}) => JSON.stringify({
  name: 'dsh-profile-desktop',
  dependencies: { 'dsh-better-sidebar': '0.28.1', ...extraDeps },
  dsh: { profile: { bundles: [...Object.keys(extraDeps), '@deepseek-ai/dsh-base', 'dsh-better-sidebar'] } },
}, null, 2)
write(join(profile, 'package.json'), manifest({
  'dsh-anywhere-sync': 'link:/Users/test/dsh-plugins/anywhere-sync',
  'test-local-plugin': `link:${localPlugin}`,
}))
write(join(profile, 'cordis.patch.yml'), '- id: ui-theme\n  config:\n    preference: system\n')
write(join(profile, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      dsh-better-sidebar:
        specifier: 0.28.1
        version: 0.28.1
      dsh-anywhere-sync:
        specifier: link:/Users/test/dsh-plugins/anywhere-sync
        version: link:../../../dsh-plugins/anywhere-sync
`)
write(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
write(join(profile, 'config.toml'), 'api_key = "must-never-sync"\n')
write(join(skills, 'lark-demo', 'SKILL.md'), '# Demo skill\n\nhello\n')
write(join(home, '.agents', '.skill-lock.json'), '{"version":3,"skills":{}}\n')

execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })

const runtime = createRuntime({ name: 'desktop', dir: profile }, { DSH_HOME: home, PATH: process.env.PATH })
runtime.skillsRoot = skills
runtime.skillsLockPath = join(home, '.agents', '.skill-lock.json')

const engine = new SyncEngine({ runtime, env: { PATH: process.env.PATH, HOME: home } })

const config = await engine.saveConfig({
  repoUrl: remote,
  branch: 'main',
  items: { plugins: true, pluginConfig: true, lock: true, profileFiles: true, skills: true },
  autoInstall: false,
  conflictMode: 'skip',
})
assert.equal(config.repoUrl, remote)

const connected = await engine.connect({})
assert.equal(connected.emptyRemote, true, 'bare repository starts empty')

const first = await engine.sync('both')
assert.equal(first.error, null, `first sync error: ${JSON.stringify(first.error)}`)
assert.ok(first.pushed.length >= 6, `expected pushes, got ${first.pushed.length}`)

const tree = () => execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).sort()
let files = tree()
assert.ok(files.includes('profile/desktop/package.json'))
assert.ok(files.includes('profile/desktop/cordis.patch.yml'))
assert.ok(files.includes('profile/desktop/pnpm-lock.yaml'))
assert.ok(files.includes('skills/lark-demo/SKILL.md'))
assert.ok(files.includes('skills/.skill-lock.json'))
assert.ok(files.includes('local-plugins/test-local-plugin/package.json'), 'local plugin package must sync')
assert.ok(files.includes('local-plugins/test-local-plugin/index.js'), 'local plugin source must sync')
assert.ok(!files.some(file => file.startsWith('local-plugins/test-local-plugin/node_modules/')), 'node_modules must not sync')
assert.ok(!files.includes('local-plugins/test-local-plugin/.env'), 'secret-looking local plugin files must not sync')
assert.ok(!files.includes('profile/desktop/config.toml'), 'secret-looking file must not sync')
const remoteManifest = execFileSync('git', ['--git-dir', remote, 'show', 'main:profile/desktop/package.json'], { encoding: 'utf8' })
const remoteLock = execFileSync('git', ['--git-dir', remote, 'show', 'main:profile/desktop/pnpm-lock.yaml'], { encoding: 'utf8' })
assert.ok(!/link:/.test(remoteManifest), 'local link dependency must not be published')
assert.ok(!/dsh-anywhere-sync/.test(remoteManifest), 'local link bundle must not be published')
assert.ok(!/test-local-plugin/.test(remoteManifest), 'local plugin dependency/bundle must not be published as a path')
assert.ok(!/link:/.test(remoteLock), 'local link lock block must not be published')
assert.match(remoteLock, /dsh-better-sidebar/)

const second = await engine.sync('both')
assert.equal(second.error, null)
assert.equal(second.pushed.length, 0, 'second sync should push nothing')
assert.equal(second.pulled.length, 0, 'second sync should pull nothing')

// Remote edit -> pull.
execFileSync('git', ['clone', '--branch', 'main', remote, reader], { stdio: 'ignore' })
write(join(reader, 'profile/desktop/cordis.patch.yml'), '- id: ui-theme\n  config:\n    preference: dark\n')
execFileSync('git', ['-C', reader, '-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-am', 'remote patch'], { stdio: 'ignore' })
execFileSync('git', ['-C', reader, 'push', 'origin', 'HEAD:main'], { stdio: 'ignore' })
const pull = await engine.sync('both')
assert.equal(pull.error, null)
assert.ok(pull.pulled.some(entry => entry.path.endsWith('cordis.patch.yml')), 'remote patch pulled')
assert.match(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), /dark/)
assert.ok(pull.backup !== null, 'overwrite should create a backup')

// Local edit -> push.
write(join(profile, 'package.json'), manifest({
  dshmarket: '1.70.2',
  'dsh-anywhere-sync': 'link:/Users/test/dsh-plugins/anywhere-sync',
  'test-local-plugin': `link:${localPlugin}`,
}))
const push = await engine.sync('both')
assert.equal(push.error, null)
assert.ok(push.pushed.some(entry => entry.path.endsWith('package.json')))
execFileSync('git', ['-C', reader, 'pull', '--ff-only'], { stdio: 'ignore' })
assert.match(readFileSync(join(reader, 'profile/desktop/package.json'), 'utf8'), /dshmarket/)

// A disabled item is left alone.
await engine.saveConfig({ items: { skills: false } })
write(join(skills, 'lark-demo', 'NEW.md'), 'new\n')
const disabled = await engine.sync('both')
assert.equal(disabled.error, null)
assert.ok(!disabled.pushed.some(entry => entry.path === 'skills/lark-demo/NEW.md'), 'disabled skills must not push')
await engine.saveConfig({ items: { skills: true } })
const enabled = await engine.sync('both')
assert.ok(enabled.pushed.some(entry => entry.path === 'skills/lark-demo/NEW.md'), 'enabled skills must push')

// Both sides edit the same file -> conflict, then explicit resolution.
execFileSync('git', ['-C', reader, 'pull', '--ff-only'], { stdio: 'ignore' })
write(join(profile, 'cordis.patch.yml'), '- id: ui-theme\n  config:\n    preference: light\n')
write(join(reader, 'profile/desktop/cordis.patch.yml'), '- id: ui-theme\n  config:\n    preference: sepia\n')
execFileSync('git', ['-C', reader, '-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-am', 'remote sepia'], { stdio: 'ignore' })
execFileSync('git', ['-C', reader, 'push', 'origin', 'HEAD:main'], { stdio: 'ignore' })
const conflicted = await engine.sync('both')
assert.equal(conflicted.error, null)
assert.ok(conflicted.conflicts.some(entry => entry.path.endsWith('cordis.patch.yml')), 'conflict detected')
assert.match(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), /light/, 'conflict must not overwrite local')

const resolved = await engine.resolve('profile/desktop/cordis.patch.yml', 'remote')
assert.equal(resolved.remaining, 0)
assert.match(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8'), /sepia/, 'resolve remote applies remote content')
const afterResolve = await engine.sync('both')
assert.equal(afterResolve.error, null)
assert.equal(afterResolve.conflicts.length, 0)

// Deletion propagates.
rmSync(join(profile, 'pnpm-workspace.yaml'))
const deleted = await engine.sync('both')
assert.equal(deleted.error, null)
assert.ok(deleted.pushed.some(entry => entry.path.endsWith('pnpm-workspace.yaml') && entry.action === 'delete'))
assert.ok(!tree().includes('profile/desktop/pnpm-workspace.yaml'), 'deleted file removed from remote')

// A remote manifest deletion is refused and healed, never propagated.
execFileSync('git', ['-C', reader, 'pull', '--ff-only'], { stdio: 'ignore' })
rmSync(join(reader, 'profile/desktop/package.json'))
execFileSync('git', ['-C', reader, '-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-am', 'drop manifest'], { stdio: 'ignore' })
execFileSync('git', ['-C', reader, 'push', 'origin', 'HEAD:main'], { stdio: 'ignore' })
const healed = await engine.sync('both')
assert.equal(healed.error, null)
assert.ok(existsSync(join(profile, 'package.json')), 'local manifest must survive a remote deletion')
assert.ok(tree().includes('profile/desktop/package.json'), 'remote manifest must be healed')

// A second engine is the "other machine": it pulls the whole shared state.
const runtimeB = createRuntime({ name: 'desktop', dir: join(sandbox, 'machine-b', 'profiles', 'desktop') }, { DSH_HOME: join(sandbox, 'machine-b'), PATH: process.env.PATH })
runtimeB.skillsRoot = join(sandbox, 'machine-b', '.agents', 'skills')
runtimeB.skillsLockPath = join(sandbox, 'machine-b', '.agents', '.skill-lock.json')
mkdirSync(runtimeB.profileDir, { recursive: true })
writeFileSync(join(runtimeB.profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-desktop',
  dependencies: { 'dsh-anywhere-sync': 'link:/Users/machine-b/dsh-plugins/anywhere-sync' },
  dsh: { profile: { bundles: ['dsh-anywhere-sync'] } },
}, null, 2))
const engineB = new SyncEngine({ runtime: runtimeB, env: { PATH: process.env.PATH, HOME: join(sandbox, 'machine-b') } })
await engineB.saveConfig({
  repoUrl: remote,
  branch: 'main',
  items: { plugins: true, pluginConfig: true, lock: true, profileFiles: false, skills: true },
  autoInstall: false,
  conflictMode: 'remote',
})
const joined = await engineB.sync('both')
assert.equal(joined.error, null)
const manifestB = readFileSync(join(runtimeB.profileDir, 'package.json'), 'utf8')
assert.match(manifestB, /dshmarket/)
assert.match(manifestB, /link:\/Users\/machine-b\/dsh-plugins\/anywhere-sync/, 'machine B keeps its own local link')
assert.match(manifestB, /dsh-anywhere-sync/, 'machine B keeps its own bundle entry')
assert.ok(!/Users\/test/.test(manifestB), 'machine A\'s path must not reach B')
const managedB = join(sandbox, 'machine-b', 'anywhere-sync', 'local-plugins', 'test-local-plugin')
assert.ok(existsSync(join(managedB, 'package.json')), 'machine B materializes the local plugin')
assert.ok(existsSync(join(managedB, 'index.js')), 'machine B materializes the source')
assert.match(manifestB, /test-local-plugin/, 'machine B registers the local plugin')
assert.match(manifestB, /link:.*anywhere-sync\/local-plugins\/test-local-plugin/, 'machine B links its managed copy')
assert.ok(joined.pulled.some(entry => entry.path === 'local-plugins/test-local-plugin/index.js'))
const stableB = await engineB.sync('both')
assert.equal(stableB.error, null)
assert.equal(stableB.pushed.length, 0, 'machine B is stable after registration')
assert.equal(stableB.pulled.length, 0, 'machine B has nothing to pull')
assert.match(readFileSync(join(runtimeB.profileDir, 'cordis.patch.yml'), 'utf8'), /sepia/)
assert.ok(existsSync(join(runtimeB.skillsRoot, 'lark-demo', 'SKILL.md')))

const status = await engine.status()
assert.equal(status.repoConfigured, true)
assert.equal(status.running, false)
assert.equal(status.conflicts.length, 0)
console.log('engine test passed')
console.log(`sandbox: ${sandbox}`)
