// Smoke test: apply all ten plugins like the host does, checking tool registration and self-running clocks.
// Writes only to a temp directory, never real state.
//   node tests/apply-smoke.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const KEYS = [
  'workspace-pulse',
  'time-sense',
  'affect-core',
  'need-tension',
  'expression-bias',
  'silence-gate',
  'residue-trace',
  'unresolved-weight',
  'body',
  'face',
]

const workspace = await mkdtemp(join(tmpdir(), 'sensorium-apply-'))
const registered = []
const disposers = []

const ctx = {
  tools: {
    register(definition) {
      registered.push(definition.name)
      return () => {}
    },
  },
  on() {
    return () => {}
  },
}

for (const key of KEYS) {
  const mod = await import(`../plugins/${key}/index.js`)
  assert.equal(typeof mod.apply, 'function', `${key} is missing apply`)
  assert.ok(mod.name.startsWith('sensorium-'), `${key} name does not start with sensorium-`)
  mod.apply(ctx, { workspace })
}

assert.equal(registered.length, KEYS.length, `expected ${KEYS.length} tools registered, got ${registered.length}`)

// Let the gears turn: pulse, need and affect write their first slot on apply.
await new Promise((resolve) => setTimeout(resolve, 900))

const sensoryDir = join(workspace, '.dsh', 'sensory')
const files = await readdir(sensoryDir)
for (const expected of ['workspace_pulse.json', 'pulse_samples.json', 'need_tension.json', 'affect_core.json']) {
  assert.ok(files.includes(expected), `missing ${expected}`)
}

const pulse = JSON.parse(await readFile(join(sensoryDir, 'workspace_pulse.json'), 'utf8'))
assert.ok(pulse.last_tick, 'pulse is missing last_tick')
assert.ok(pulse.reading.samples >= 1, 'pulse samples are empty')

const need = JSON.parse(await readFile(join(sensoryDir, 'need_tension.json'), 'utf8'))
assert.ok(need.last_integrated, 'need is missing last_integrated')

console.log(`registered: ${registered.join(', ')}`)
console.log(`state: ${files.sort().join(', ')}`)
console.log('\napply smoke: ok')
