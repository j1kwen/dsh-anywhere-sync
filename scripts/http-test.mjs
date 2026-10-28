/** Offline check of the HTTP surface: admission, bodies, and the sync flow. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { SyncEngine } from '../lib/engine.js'
import { createRuntime } from '../lib/paths.js'
import { createRouteHandler } from '../lib/routes.js'

const root = new URL('..', import.meta.url).pathname
const sandbox = join(root, '.http-test')
const home = join(sandbox, 'home')
const profile = join(home, 'profiles', 'desktop')
const remote = join(sandbox, 'remote.git')
rmSync(sandbox, { recursive: true, force: true })
mkdirSync(profile, { recursive: true })
mkdirSync(join(home, '.agents', 'skills'), { recursive: true })
writeFileSync(join(profile, 'package.json'), '{"name":"p","dependencies":{}}\n')
writeFileSync(join(profile, 'cordis.patch.yml'), '- id: ui-theme\n  config:\n    preference: dark\n')
writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
writeFileSync(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })

const runtime = createRuntime({ name: 'desktop', dir: profile }, { DSH_HOME: home })
runtime.skillsRoot = join(home, '.agents', 'skills')
runtime.skillsLockPath = join(home, '.agents', '.skills-lock.json')
const engine = new SyncEngine({ runtime, env: { PATH: process.env.PATH } })
const handler = createRouteHandler({ engine, getContext: () => ({ get: () => undefined }) })

const server = createServer((request, response) => {
  handler(request, response).catch((error) => {
    response.writeHead(500)
    response.end(String(error))
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

async function call(path, options = {}) {
  const response = await fetch(`${origin}/anywhere-sync/api${path}`, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json', origin }),
      ...(options.headers ?? {}),
    },
  })
  return { status: response.status, body: await response.json() }
}

let result = await call('/status')
assert.equal(result.status, 200)
assert.equal(result.body.ok, true)
assert.equal(result.body.value.repoConfigured, false)
assert.equal(result.body.value.running, false)
assert.ok(Array.isArray(result.body.value.items) && result.body.value.items.length === 7)

// Calling sync before configuration is a normal, recorded failure.
result = await call('/sync', { method: 'POST', body: JSON.stringify({ mode: 'both' }) })
assert.equal(result.body.value.started, true)
for (let i = 0; i < 100; i += 1) {
  const status = await call('/status')
  if (status.body.value.running === false && status.body.value.lastResult !== null) break
  await new Promise(resolve => setTimeout(resolve, 50))
}
result = await call('/status')
assert.equal(result.body.value.lastResult.error.code, 'no-config')

result = await call('/config', { method: 'POST', body: JSON.stringify({ repoUrl: remote, branch: 'main', autoInstall: false }) })
assert.equal(result.status, 200, JSON.stringify(result.body))
assert.equal(result.body.value.repoUrl, remote)

result = await call('/sync', { method: 'POST', body: JSON.stringify({ mode: 'both' }) })
assert.equal(result.status, 200)
assert.equal(result.body.value.started, true)

for (let i = 0; i < 100; i += 1) {
  const status = await call('/status')
  if (status.body.value.running === false && status.body.value.lastResult !== null) break
  await new Promise(resolve => setTimeout(resolve, 50))
}
result = await call('/status')
assert.equal(result.body.value.running, false)
assert.equal(result.body.value.lastResult.error, null, JSON.stringify(result.body.value.lastResult.error))
assert.ok(result.body.value.lastResult.pushedTotal >= 4)

for (const item of ['plugins', 'localPlugins', 'pluginConfig', 'pluginData', 'lock', 'profileFiles', 'skills']) {
  result = await call(`/files?item=${item}`)
  assert.equal(result.status, 200, `${item}: ${JSON.stringify(result.body)}`)
  assert.equal(result.body.value.item, item)
}
result = await call('/config', {
  method: 'POST',
  body: JSON.stringify({ pluginDataPaths: ['.dshw-size.json', '../escape', '/absolute', 'profiles/desktop'] }),
})
assert.equal(result.status, 200, JSON.stringify(result.body))
assert.deepEqual(result.body.value.pluginDataPaths, ['.dshw-size.json'])

result = await call('/files?item=plugins')
assert.equal(result.status, 200)
assert.ok(result.body.value.files.some(file => file.path.endsWith('package.json')))
result = await call('/files?item=')
assert.equal(result.status, 400, 'a missing query is still rejected')

result = await call('/config', {
  method: 'POST',
  body: JSON.stringify({ repoUrl: remote }),
  headers: { origin: 'http://evil.example' },
})
assert.equal(result.status, 403)

result = await call('/config', { method: 'POST', body: '{not json' })
assert.equal(result.status, 400)

result = await call('/files?item=nope')
assert.equal(result.status, 400)

result = await call('/nope')
assert.equal(result.status, 404)

console.log('http test passed')

// A context whose Connection fence refuses everything must be honoured.
engine.dispose()
server.close()
const strictHandler = createRouteHandler({
  engine,
  getContext: () => ({ get: () => ({ requestRejection: () => 403 }) }),
})
const strictServer = createServer((request, response) => {
  strictHandler(request, response).catch(() => {
    response.writeHead(500)
    response.end()
  })
})
await new Promise(resolve => strictServer.listen(0, '127.0.0.1', resolve))
const strictOrigin = `http://127.0.0.1:${strictServer.address().port}`
const refused = await fetch(`${strictOrigin}/anywhere-sync/api/status`)
assert.equal(refused.status, 403)
console.log('connection fence test passed')
strictServer.close()
