/**
 * GitHub metadata for the repository card.
 *
 * Git access is proven by `git ls-remote`; this API call exists for the facts
 * git cannot cheaply answer — private/public, the default branch, and whether
 * the token can push. It is skipped for non-GitHub remotes and for local test
 * repositories.
 */
import { SyncError } from './errors.js'
import { githubTarget } from './git.js'

const API_TIMEOUT_MS = 15_000

/**
 * @param {string} url normalized repository URL
 * @param {string} token personal access token (empty for public repositories)
 * @returns {Promise<null | { fullName: string, private: boolean, defaultBranch: string | null, canPush: boolean, htmlUrl: string | null, owner: string, repo: string }>}
 */
export async function inspectGitHubRepository(url, token) {
  const target = githubTarget(url)
  if (target === null) return null
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'dsh-anywhere-sync',
    'x-github-api-version': '2022-11-28',
  }
  if (token !== '') headers.authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}`, {
      headers,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (error) {
    throw new SyncError('remote-unreachable', `cannot reach api.github.com: ${String(error?.message ?? error)}`)
  }

  if (response.status === 401) {
    throw new SyncError('auth-failed', 'GitHub rejected the token (401). Create a new token with the repo scope.')
  }
  if (response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (remaining === '0') {
      throw new SyncError('rate-limited', 'GitHub API rate limit reached; try again later or use a token')
    }
    throw new SyncError('auth-failed', 'GitHub refused access to this repository (403)')
  }
  if (response.status === 404) {
    throw new SyncError(
      token === '' ? 'token-required' : 'repo-not-found',
      token === ''
        ? 'repository not found; private repositories need a token with repo access'
        : 'repository not found, or the token cannot see it',
    )
  }
  if (!response.ok) {
    throw new SyncError('github-error', `GitHub answered ${response.status}`)
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new SyncError('github-error', 'GitHub returned an unreadable response')
  }
  return {
    fullName: typeof body.full_name === 'string' ? body.full_name : `${target.owner}/${target.repo}`,
    private: body.private === true,
    defaultBranch: typeof body.default_branch === 'string' && body.default_branch !== '' ? body.default_branch : null,
    canPush: body.permissions !== null && typeof body.permissions === 'object' && body.permissions.push === true,
    htmlUrl: typeof body.html_url === 'string' ? body.html_url : null,
    owner: target.owner,
    repo: target.repo,
  }
}
