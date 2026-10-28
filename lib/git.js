/**
 * Git is the transport, never the source of truth.
 *
 * The working copy under `$DSH_HOME/harness-sync/repo` is a mirror: every sync
 * fetches the configured branch, hard-resets to it, computes the three-way
 * difference against the local files, then commits and pushes only the paths
 * this sync changed. Because the branch tip is the shared truth and the base
 * hashes live in plugin state, a machine never has to resolve a merge: a
 * simultaneous edit is reported as a conflict and resolved explicitly.
 */
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { expandHomePath } from './paths.js'
import { SyncError } from './errors.js'

const GIT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024

const ASKPASS_SCRIPT = `#!/bin/sh
# Written by dsh-harness-sync. The token arrives through the environment so it
# is never stored in a Git configuration file or a URL.
case "$1" in
  Username*|username*) printf '%s\\n' "\${HARNESS_SYNC_USERNAME:-x-access-token}" ;;
  Password*|password*) printf '%s\\n' "\${HARNESS_SYNC_TOKEN:-}" ;;
  *) printf '\\n' ;;
esac
`

/** Probe whether a usable git executable exists. */
export async function gitAvailable() {
  return await new Promise((resolvePromise) => {
    try {
      execFile('git', ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
        resolvePromise(error === null && String(stdout).trim() !== '')
      }).on('error', () => resolvePromise(false))
    } catch {
      resolvePromise(false)
    }
  })
}

async function runGit(runtime, options) {
  const { args, token = '', timeoutMs = GIT_TIMEOUT_MS } = options
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    // Never let a user credential helper answer for this repository; the
    // askpass script is the single, scoped channel for the token.
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM ?? '0',
  }
  if (token !== '') {
    ensureAskpass(runtime)
    env.GIT_ASKPASS = runtime.askpassPath
    env.HARNESS_SYNC_TOKEN = token
    env.HARNESS_SYNC_USERNAME = 'x-access-token'
  }
  const prefix = [
    '-c', 'credential.helper=',
    '-c', 'core.hooksPath=' + runtime.emptyHooksDir,
    '-c', 'core.quotepath=false',
    '-c', 'commit.gpgsign=false',
    '-c', 'user.name=dsh-harness-sync',
    '-c', 'user.email=harness-sync@localhost',
    '-c', 'advice.detachedHead=false',
  ]
  return await new Promise((resolvePromise) => {
    let child
    try {
      child = execFile('git', [...prefix, ...args], {
        cwd: existsSync(runtime.repoDir) ? runtime.repoDir : undefined,
        env,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        const timedOut = error !== null && error.killed === true
        const code = error === null ? 0 : (typeof error.code === 'number' ? error.code : 1)
        resolvePromise({
          code,
          timedOut,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '') || (error !== null && error.message ? error.message : ''),
        })
      })
      child.on('error', (error) => {
        resolvePromise({ code: 127, timedOut: false, stdout: '', stderr: error.message })
      })
    } catch (error) {
      resolvePromise({ code: 127, timedOut: false, stdout: '', stderr: String(error?.message ?? error) })
    }
  })
}

function ensureAskpass(runtime) {
  mkdirSync(runtime.syncDir, { recursive: true })
  mkdirSync(runtime.emptyHooksDir, { recursive: true })
  if (!existsSync(runtime.askpassPath)) {
    writeFileSync(runtime.askpassPath, ASKPASS_SCRIPT, { mode: 0o700 })
    try {
      chmodSync(runtime.askpassPath, 0o700)
    } catch {
      // Non-POSIX platforms ignore the mode.
    }
  }
}

/** Run one git command in the plugin's repository, with its scoped options. */
export async function git(runtime, args, options = {}) {
  const result = await runGit(runtime, { args, ...options })
  if (options.allowFailure !== true && result.code !== 0) {
    throw new SyncError(gitErrorCode(result.stderr), gitErrorDetail(result), { stderr: tail(result.stderr) })
  }
  return result
}

function tail(text, limit = 1200) {
  const value = String(text ?? '').trim()
  return value.length > limit ? value.slice(-limit) : value
}

function gitErrorDetail(result) {
  if (result.timedOut) return 'git timed out'
  return tail(result.stderr) || `git exited with code ${result.code}`
}

function gitErrorCode(stderr) {
  const text = String(stderr ?? '')
  if (/could not read Username|Authentication failed|terminal prompts disabled|Permission denied \(publickey\)|Invalid username or password|403 Forbidden/i.test(text)) {
    return 'auth-failed'
  }
  if (/Could not resolve host|unable to access|Failed to connect|Connection (timed out|refused)|network is unreachable/i.test(text)) {
    return 'remote-unreachable'
  }
  if (/not a git repository/i.test(text)) return 'repo-corrupt'
  return 'git-failed'
}

/** Validate a branch name with git itself, plus the two options we rely on. */
export async function validateBranch(runtime, branch) {
  if (typeof branch !== 'string') throw new SyncError('bad-branch', 'branch must be a string')
  const value = branch.trim()
  if (value === '' || value.length > 200) throw new SyncError('bad-branch', 'branch name is empty or too long')
  if (value.startsWith('-') || /[\s~^:?*\[\]\\]/.test(value) || value.toLowerCase() === 'head') {
    throw new SyncError('bad-branch', `"${value}" is not a valid branch name`)
  }
  const result = await runGit(runtime, {
    args: ['check-ref-format', '--branch', value],
    timeoutMs: 10_000,
  })
  if (result.code !== 0) throw new SyncError('bad-branch', `"${value}" is not a valid branch name`)
  return value
}

/**
 * Normalize what the user typed into a git URL.
 *
 * `owner/repo` is the GitHub shorthand the UI offers; every other form git
 * accepts (https, ssh, file, or an absolute/relative path for a local test
 * repository) passes through unchanged.
 */
export function normalizeRepoUrl(input) {
  if (typeof input !== 'string') throw new SyncError('bad-repo-url', 'repository URL must be a string')
  const raw = input.trim()
  if (raw === '') throw new SyncError('bad-repo-url', 'repository URL is required')
  if (raw.length > 500) throw new SyncError('bad-repo-url', 'repository URL is too long')
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return `https://github.com/${raw}.git`
  if (/^(https?|ssh|git|file):\/\//i.test(raw)) return raw
  if (/^git@[^:]+:.+/.test(raw)) return raw
  if (raw.startsWith('/') || raw.startsWith('~/') || raw.startsWith('./') || raw.startsWith('../')) {
    return resolve(expandHomePath(raw))
  }
  if (/^[A-Za-z]:[\\/]/.test(raw)) return raw
  throw new SyncError('bad-repo-url', 'use a GitHub URL (https://github.com/owner/repo) or a local repository path')
}

/** The `owner/repo` pair when this is a github.com HTTPS URL. */
export function githubTarget(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null
    const segments = parsed.pathname.replace(/\.git$/, '').split('/').filter(Boolean)
    if (segments.length < 2) return null
    return { owner: segments[0], repo: segments[1] }
  } catch {
    return null
  }
}

/** List the remote's branches; throws when the remote cannot be reached. */
export async function listRemoteBranches(runtime, url, token) {
  const result = await runGit(runtime, {
    args: ['ls-remote', '--heads', url],
    token,
    timeoutMs: 45_000,
  })
  if (result.code !== 0) {
    throw new SyncError(gitErrorCode(result.stderr), gitErrorDetail(result), { stderr: tail(result.stderr) })
  }
  const branches = []
  for (const line of result.stdout.split('\n')) {
    const match = /^[0-9a-f]+\trefs\/heads\/(.+)$/.exec(line.trim())
    if (match !== null) branches.push(match[1])
  }
  return branches
}

async function remoteUrlOf(runtime) {
  const result = await runGit(runtime, { args: ['remote', 'get-url', 'origin'], timeoutMs: 10_000 })
  return result.code === 0 ? result.stdout.trim() : null
}

/**
 * Bring the mirror to the remote branch tip.
 * @returns {{ hasRemoteBranch: boolean, commit: string | null, emptyRemote: boolean }}
 */
export async function prepareRepository(runtime, { url, branch, token }) {
  mkdirSync(runtime.repoDir, { recursive: true })
  mkdirSync(runtime.emptyHooksDir, { recursive: true })

  if (!existsSync(resolve(runtime.repoDir, '.git'))) {
    const init = await runGit(runtime, { args: ['init'], timeoutMs: 30_000 })
    if (init.code !== 0) throw new SyncError('git-failed', gitErrorDetail(init))
    // Point HEAD at the configured branch before the first commit.
    await runGit(runtime, { args: ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], timeoutMs: 10_000 })
  }

  const current = await remoteUrlOf(runtime)
  if (current === null) {
    const added = await runGit(runtime, { args: ['remote', 'add', 'origin', url], timeoutMs: 10_000 })
    if (added.code !== 0) throw new SyncError('git-failed', gitErrorDetail(added))
  } else if (current !== url) {
    const changed = await runGit(runtime, { args: ['remote', 'set-url', 'origin', url], timeoutMs: 10_000 })
    if (changed.code !== 0) throw new SyncError('git-failed', gitErrorDetail(changed))
  }

  const fetch = await runGit(runtime, {
    args: ['fetch', '--prune', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
    token,
  })
  if (fetch.code !== 0) {
    // Distinguish "this repository has no commits yet" from "the branch does
    // not exist" and from "the remote is unreachable"; the answer decides
    // whether the UI should offer the available branches or the token field.
    const branches = await listRemoteBranches(runtime, url, token)
    if (branches.length === 0) {
      return { hasRemoteBranch: false, commit: null, emptyRemote: true }
    }
    throw new SyncError('branch-missing', `branch "${branch}" does not exist on the remote`, { branches })
  }

  const remoteRef = `refs/remotes/origin/${branch}`
  const verify = await runGit(runtime, { args: ['rev-parse', '--verify', '--quiet', remoteRef], timeoutMs: 10_000 })
  if (verify.code !== 0) {
    return { hasRemoteBranch: false, commit: null, emptyRemote: false }
  }
  const reset = await runGit(runtime, { args: ['reset', '--hard', remoteRef], timeoutMs: 30_000 })
  if (reset.code !== 0) throw new SyncError('git-failed', gitErrorDetail(reset))
  // The mirror must contain exactly the remote tree. This is what makes
  // "remote deleted the file" observable, and it clears anything a previous
  // interrupted run left behind.
  const clean = await runGit(runtime, { args: ['clean', '-fdxq'], timeoutMs: 30_000 })
  if (clean.code !== 0) throw new SyncError('git-failed', gitErrorDetail(clean))
  const head = await runGit(runtime, { args: ['rev-parse', 'HEAD'], timeoutMs: 10_000 })
  return {
    hasRemoteBranch: true,
    commit: head.code === 0 ? head.stdout.trim() : null,
    emptyRemote: false,
  }
}

/**
 * Stage exactly the paths this sync wrote, commit, and push.
 * @returns {{ pushed: boolean, commit: string | null, files: number }}
 */
export async function commitAndPush(runtime, { branch, token, paths, message }) {
  const unique = [...new Set(paths.filter(path => typeof path === 'string' && path !== '' && !path.startsWith('-')))]
  if (unique.length === 0) return { pushed: false, commit: null, files: 0 }

  for (let index = 0; index < unique.length; index += 80) {
    const chunk = unique.slice(index, index + 80)
    const added = await runGit(runtime, { args: ['add', '-A', '--', ...chunk], timeoutMs: 60_000 })
    if (added.code !== 0) throw new SyncError('git-failed', gitErrorDetail(added))
  }

  const staged = await runGit(runtime, { args: ['diff', '--cached', '--quiet'], timeoutMs: 30_000 })
  if (staged.code === 0) return { pushed: false, commit: null, files: 0 }
  if (staged.code !== 1) throw new SyncError('git-failed', gitErrorDetail(staged))

  const commit = await runGit(runtime, { args: ['commit', '-m', message], timeoutMs: 60_000 })
  if (commit.code !== 0) throw new SyncError('git-failed', gitErrorDetail(commit))
  const head = await runGit(runtime, { args: ['rev-parse', 'HEAD'], timeoutMs: 10_000 })
  const commitId = head.code === 0 ? head.stdout.trim() : null

  const push = await runGit(runtime, {
    args: ['push', 'origin', `HEAD:refs/heads/${branch}`],
    token,
    timeoutMs: GIT_TIMEOUT_MS,
  })
  if (push.code !== 0) {
    const text = push.stderr
    if (/non-fast-forward|fetch first|\[rejected\]|tip of your current branch is behind/i.test(text)) {
      throw new SyncError('push-rejected', 'the remote moved while this sync was running', { commit: commitId })
    }
    throw new SyncError(gitErrorCode(text), gitErrorDetail(push), { stderr: tail(text) })
  }
  return { pushed: true, commit: commitId, files: unique.length }
}

/** Whether an absolute path looks like a git working tree. */
export function isGitRepository(directory) {
  return typeof directory === 'string' && isAbsolute(directory) && existsSync(resolve(directory, '.git'))
}
