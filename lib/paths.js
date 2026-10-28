/**
 * Filesystem facts for this Harness installation.
 *
 * Nothing here is configurable from the UI: the profile being synced is the
 * profile this plugin is mounted in, and the Harness home is resolved exactly
 * like the rest of DSH resolves it (`DSH_HOME`, else `~/.dsh`).
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Expand the tilde forms DSH accepts in configuration values. */
export function expandHomePath(value) {
  if (typeof value !== 'string') return value
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

/** Resolve the Harness home: an explicit `DSH_HOME`, else `~/.dsh`. */
export function resolveDshHome(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return resolve(expandHomePath(configured !== '' ? configured : join(homedir(), '.dsh')))
}

/** Where user-installed skills live; `~/.agents/skills` when present. */
function resolveSkillsRoot(dshHome) {
  const candidates = [join(homedir(), '.agents', 'skills'), join(dshHome, 'skills')]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0]
}

/**
 * Build the runtime facts once, at plugin activation.
 *
 * `profileContext` is the launcher's public service (name + directory). It is
 * absent when DSH was booted without a profile; the documented environment
 * variables and the conventional profile path are the fallbacks.
 */
export function createRuntime(profileContext, env = process.env) {
  const dshHome = resolveDshHome(env)
  const contextName = profileContext !== null && typeof profileContext === 'object'
    && typeof profileContext.name === 'string' && profileContext.name.trim() !== ''
    ? profileContext.name.trim()
    : ''
  const envName = typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE.trim() !== ''
    ? env.DSH_PROFILE.trim()
    : ''
  const rawName = contextName !== '' ? contextName : (envName !== '' ? envName : 'default')
  // The name is used in a repository path and in the plugin's own directory
  // names. Keep it recognizable but never let it introduce a path separator.
  const profileName = rawName.replace(/[^A-Za-z0-9._@-]/g, '-')

  const contextDir = profileContext !== null && typeof profileContext === 'object'
    && typeof profileContext.dir === 'string' && isAbsolute(profileContext.dir)
    ? profileContext.dir
    : ''
  const envDir = typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR.trim() !== ''
    ? resolve(expandHomePath(env.DSH_PROFILE_DIR.trim()))
    : ''
  const profileDir = resolve(contextDir !== '' ? contextDir : (envDir !== '' ? envDir : join(dshHome, 'profiles', profileName)))

  const skillsRoot = resolveSkillsRoot(dshHome)
  const syncDir = join(dshHome, 'harness-sync')

  return {
    dshHome,
    profileName,
    profileDir,
    skillsRoot,
    skillsLockPath: join(dirname(skillsRoot), '.skill-lock.json'),
    syncDir,
    repoDir: join(syncDir, 'repo'),
    configPath: join(syncDir, 'config.json'),
    statePath: join(syncDir, 'state.json'),
    credentialsPath: join(syncDir, 'credentials.json'),
    backupDir: join(syncDir, 'backups'),
    askpassPath: join(syncDir, 'askpass.sh'),
    emptyHooksDir: join(syncDir, 'empty-hooks'),
    profileRepoPrefix: `profile/${profileName}`,
  }
}

/** Render a runtime for a diagnostic line without exposing the token file. */
export function describeRuntime(runtime) {
  return {
    dshHome: runtime.dshHome,
    profile: runtime.profileName,
    profileDir: runtime.profileDir,
    skillsRoot: runtime.skillsRoot,
    syncDir: runtime.syncDir,
  }
}
