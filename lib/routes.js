/**
 * `/anywhere-sync/api` — the settings page's only door to the Host.
 *
 * The routes live on the bare web server, so they ask the Connection service
 * for the same Host/Origin and browser-login decision `/api` would apply. A
 * deployment without that service (an old or headless carrier) falls back to a
 * loopback-only fence. Mutating requests additionally require a same-origin
 * `Origin`, which is what stops another page in the browser from driving the
 * sync. The token is never part of a response.
 */
import { SyncError, toFailure } from './errors.js'
import { ITEM_IDS } from './items.js'

const MAX_BODY_BYTES = 256 * 1024
const ROUTE_PREFIX = '/anywhere-sync/api'

const STATUS_BY_CODE = {
  'bad-request': 400,
  'bad-repo-url': 400,
  'bad-branch': 400,
  'no-config': 400,
  'not-conflicted': 409,
  'busy': 409,
  'install-busy': 409,
  'git-missing': 424,
  'git-failed': 500,
  'repo-corrupt': 500,
  'write-failed': 500,
  'backup-failed': 500,
  'read-truncated': 500,
  'internal': 500,
  'auth-failed': 401,
  'token-required': 401,
  'repo-not-found': 404,
  'branch-missing': 409,
  'remote-unreachable': 502,
  'push-rejected': 502,
  'push-failed': 502,
  'github-error': 502,
  'rate-limited': 429,
  'install-failed': 500,
  'install-timeout': 504,
}

/**
 * @param {object} options
 * @param {import('./engine.js').SyncEngine} options.engine
 * @param {() => { get(name: string): unknown }} options.getContext
 * @param {(message: string, detail?: unknown) => void} [options.logger]
 */
export function createRouteHandler({ engine, getContext, logger }) {
  const log = logger ?? (() => {})

  return async function handleRoute(request, response) {
    let payload = {}
    try {
      const url = new URL(request.url ?? '/', 'http://harness.local')
      if (!url.pathname.startsWith(ROUTE_PREFIX)) {
        sendJson(response, 404, { ok: false, error: { code: 'not-found', message: 'unknown route' } })
        return
      }
      const route = url.pathname.slice(ROUTE_PREFIX.length) || '/'
      const method = request.method ?? 'GET'

      const rejected = admission(request, getContext())
      if (rejected !== 0) {
        sendJson(response, rejected, {
          ok: false,
          error: {
            code: rejected === 401 ? 'auth-required' : 'forbidden',
            message: rejected === 401
              ? 'sign in to DSH again and reopen this page'
              : 'this request came from an untrusted origin and was refused',
          },
        })
        return
      }

      if (method === 'OPTIONS') {
        response.writeHead(204, { 'cache-control': 'no-store' })
        response.end()
        return
      }

      if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'cross-origin request refused' } })
        return
      }

      switch (`${method} ${route}`) {
        case 'GET /status': {
          payload = await engine.status()
          sendJson(response, 200, { ok: true, value: payload })
          return
        }
        case 'GET /files': {
          const item = url.searchParams.get('item') ?? ''
          if (!ITEM_IDS.includes(item)) throw new SyncError('bad-request', 'item is unknown')
          payload = engine.listFiles(item)
          sendJson(response, 200, { ok: true, value: payload })
          return
        }
        case 'POST /config': {
          const body = await readJsonBody(request)
          await engine.saveConfig(body)
          payload = await engine.status()
          sendJson(response, 200, { ok: true, value: payload })
          return
        }
        case 'POST /connect': {
          const body = await readJsonBody(request)
          payload = await engine.connect(body)
          sendJson(response, 200, { ok: true, value: payload })
          return
        }
        case 'POST /sync': {
          const body = await readJsonBody(request)
          const mode = body.mode === 'push' || body.mode === 'pull' ? body.mode : 'both'
          if (engine.running !== null) {
            sendJson(response, 200, { ok: true, value: { started: false, running: true } })
            return
          }
          // Kick the run off and answer immediately: a pull can install
          // dependencies and take minutes. The page follows `status`.
          void engine.sync(mode).catch((error) => log(`sync rejected: ${String(error?.message ?? error)}`))
          sendJson(response, 200, { ok: true, value: { started: true, running: true } })
          return
        }
        case 'POST /resolve': {
          const body = await readJsonBody(request)
          if (typeof body.path !== 'string' || body.path === '') throw new SyncError('bad-request', 'path is required')
          payload = await engine.resolve(body.path, body.side)
          sendJson(response, 200, { ok: true, value: payload })
          return
        }
        case 'POST /install': {
          payload = await engine.install()
          sendJson(response, 200, { ok: true, value: payload })
          return
        }
        default:
          sendJson(response, 404, { ok: false, error: { code: 'not-found', message: `unknown route ${method} ${route}` } })
          return
      }
    } catch (error) {
      const failure = toFailure(error)
      const status = STATUS_BY_CODE[failure.code] ?? 500
      log(`route failed: ${failure.code} ${failure.message}`)
      if (!response.headersSent) sendJson(response, status, { ok: false, error: failure })
    }
  }
}

/** Ask the deployment's own request fence; fall back to loopback-only. */
function admission(request, ctx) {
  let connection
  try {
    connection = ctx?.get?.('connection')
  } catch {
    connection = undefined
  }
  if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
    try {
      const rejection = connection.requestRejection({ headers: request.headers })
      if (rejection !== undefined && rejection !== null) return rejection
      return 0
    } catch {
      // A gate that throws admitted nothing.
      return 403
    }
  }
  const host = String(request.headers.host ?? '').toLowerCase()
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1' ? 0 : 403
}

function sameOrigin(request) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

async function readJsonBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new SyncError('bad-request', 'request body is too large')
    chunks.push(buffer)
  }
  if (total === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new SyncError('bad-request', 'request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyncError('bad-request', 'request body must be a JSON object')
  }
  return parsed
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
  })
  response.end(text)
}
