/**
 * Package smoke checks that need no network and no install.
 *
 * Runs in CI before the transfer tests, and locally via `npm run check`.
 * It answers the questions a storefront asks before installing a plugin:
 * is this a bundle, is the patch beside the manifest, are the client/locale
 * resources present, and did a credential slip into the tree?
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const read = (path) => readFileSync(join(root, path), 'utf8')
const pkg = JSON.parse(read('package.json'))

assert.equal(typeof pkg.name, 'string')
assert.match(pkg.name, /^[a-z0-9][a-z0-9._-]*$/)
assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
assert.equal(pkg.type, 'module')
assert.equal(pkg.license, 'MIT')
assert.ok(existsSync(join(root, 'LICENSE')), 'LICENSE is missing')
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch must be declared')
assert.ok(existsSync(join(root, 'cordis.patch.yml')), 'cordis.patch.yml is missing')
assert.match(read('cordis.patch.yml'), new RegExp(`name:\\s*['"]?${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
assert.ok(pkg.dsh?.client?.platform, 'dsh.client.platform is missing')
assert.equal(pkg.dsh.client.platform, 'web')

for (const [field, target] of Object.entries({ '.': pkg.exports['.'], './client': pkg.exports['./client'] })) {
  assert.equal(typeof target, 'string', `exports["${field}"] must be a string`)
  assert.ok(existsSync(join(root, target)), `exports["${field}"] points at a missing file: ${target}`)
}
assert.match(read('icon.svg').trimStart(), /^<svg[\s>]/, 'icon.svg is not an SVG document')
assert.ok(existsSync(join(root, 'assets/icon-180.png')), 'assets/icon-180.png is missing')

for (const locale of ['en', 'zh']) {
  const meta = JSON.parse(read(`locale/${locale}.json`)).meta
  assert.equal(typeof meta?.title, 'string', `locale/${locale}.json meta.title is missing`)
  assert.ok(meta.title.trim() !== '', `locale/${locale}.json meta.title is empty`)
  assert.equal(typeof meta?.description, 'string', `locale/${locale}.json meta.description is missing`)
  assert.ok(meta.description.trim() !== '', `locale/${locale}.json meta.description is empty`)
}

/** Every regular file, relative to the package root, minus generated data. */
function walk(directory = root, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', '.engine-test', '.http-test', '.install-test'].includes(entry.name)) continue
      walk(join(directory, entry.name), files)
      continue
    }
    if (!entry.isFile()) continue
    files.push(relative(root, join(directory, entry.name)).split(sep).join('/'))
  }
  return files
}

/** Translate the small glob subset used by `files` into a regular expression. */
function filesMatcher(pattern) {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

const files = walk()
for (const pattern of pkg.files ?? []) {
  const matcher = filesMatcher(pattern)
  assert.ok(files.some(file => matcher.test(file) || file.startsWith(`${pattern}/`)), `files entry matches nothing: ${pattern}`)
}
for (const required of ['index.js', 'client.js', 'lib/engine.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'README.md', 'README.zh.md', 'LICENSE']) {
  assert.ok(files.includes(required), `required file is missing: ${required}`)
}

// A credential must never be committed. The patterns are deliberately narrow:
// these are real token shapes, not the placeholders the UI and docs use.
const TOKEN_SHAPES = [
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bgho_[A-Za-z0-9]{20,}\b/,
  /\bghu_[A-Za-z0-9]{20,}\b/,
  /\bghs_[A-Za-z0-9]{20,}\b/,
]
for (const file of files) {
  if (!/\.(?:js|mjs|cjs|json|md|yml|yaml|txt)$/.test(file)) continue
  const text = read(file)
  for (const shape of TOKEN_SHAPES) {
    assert.ok(!shape.test(text), `possible access token in ${file}`)
  }
}
assert.ok(!existsSync(join(root, 'credentials.json')), 'credentials.json must never be committed')
assert.ok(!existsSync(join(root, '.env')), '.env must never be committed')

console.log(`package check passed: ${pkg.name}@${pkg.version}, ${files.length} files`)
