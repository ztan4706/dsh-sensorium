// 冒烟测试：像宿主那样把十个插件都 apply 一遍，看工具注册和自走的钟有没有起效。
// 只写临时目录，不碰真实状态。
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
  assert.equal(typeof mod.apply, 'function', `${key} 缺少 apply`)
  assert.ok(mod.name.startsWith('sensorium-'), `${key} 的 name 不以 sensorium- 开头`)
  mod.apply(ctx, { workspace })
}

assert.equal(registered.length, KEYS.length, `应注册 ${KEYS.length} 个工具，实际 ${registered.length}`)

// 等齿轮转一下：脉搏、需求、情绪在 apply 时就会写第一格。
await new Promise((resolve) => setTimeout(resolve, 900))

const sensoryDir = join(workspace, '.dsh', 'sensory')
const files = await readdir(sensoryDir)
for (const expected of ['workspace_pulse.json', 'pulse_samples.json', 'need_tension.json', 'affect_core.json']) {
  assert.ok(files.includes(expected), `缺少 ${expected}`)
}

const pulse = JSON.parse(await readFile(join(sensoryDir, 'workspace_pulse.json'), 'utf8'))
assert.ok(pulse.last_tick, '脉搏缺少 last_tick')
assert.ok(pulse.reading.samples >= 1, '脉搏采样为空')

const need = JSON.parse(await readFile(join(sensoryDir, 'need_tension.json'), 'utf8'))
assert.ok(need.last_integrated, '需求缺少 last_integrated')

console.log(`registered: ${registered.join(', ')}`)
console.log(`state: ${files.sort().join(', ')}`)
console.log('\napply smoke: ok')
