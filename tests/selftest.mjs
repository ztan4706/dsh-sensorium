// 感官 v2 自测：验"时间真的从我身上走过去"这件事。
// 用法：node 感官/_v2_selftest.mjs
// 全部在临时目录里跑，不碰真状态。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { senseNeedTension } from '../plugins/need-tension/core.js'
import { senseAffectCore } from '../plugins/affect-core/core.js'
import { senseWorkspacePulse } from '../plugins/workspace-pulse/core.js'

const root = await mkdtemp(join(tmpdir(), 'sense-v2-'))
const room = join(root, 'room')
const houseSensory = join(root, '.dsh', 'sensory')
const roomSensory = join(room, '.dsh', 'sensory')
await mkdir(houseSensory, { recursive: true })
await mkdir(roomSensory, { recursive: true })

const MIN = 60 * 1000
const T0 = Date.parse('2026-10-24T00:00:00+08:00')

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function slotsBetween(from, to, activity) {
  const samples = []
  for (let t = from + 30 * MIN; t <= to; t += 30 * MIN) samples.push({ t, a: activity, q: 0 })
  return samples
}

// ── 1. 有动静的 10 小时要补回来 ─────────────────────────────
const busy = slotsBetween(T0, T0 + 600 * MIN, 0.6)
await writeJson(join(houseSensory, 'pulse_samples.json'), { samples: busy })
await writeJson(join(houseSensory, 'workspace_pulse.json'), {
  reading: { activity_level: 0.6, quiet_minutes: 5 },
})
await writeJson(join(roomSensory, 'need_tension.json'), {
  last_read: new Date(T0).toISOString(),
  last_integrated: new Date(T0).toISOString(),
  reading: {
    connection: { saturation: 0.9 },
    stimulation: { saturation: 0.8 },
    resolution: { saturation: 0.7 },
  },
})

const busyState = await senseNeedTension({ workspace: room, now: new Date(T0 + 600 * MIN) })
assert.equal(busyState.reading.basis, 'samples', '有动静的窗口 basis 应是 samples')
assert.equal(busyState.reading.windows_integrated, 20, '10 小时应结算 20 格')
assert.ok(busyState.reading.active_windows >= 19, '绝大多数格子应有动静')
assert.ok(busyState.reading.connection.saturation > 0.5, '忙了一天，连接不该是空的')

// ── 2. 空转的 15 小时只衰减 ─────────────────────────────────
await writeFile(join(houseSensory, 'pulse_samples.json'), JSON.stringify({ samples: [] }), 'utf8')
await writeJson(join(roomSensory, 'need_tension.json'), {
  last_read: new Date(T0).toISOString(),
  last_integrated: new Date(T0).toISOString(),
  reading: {
    connection: { saturation: 0.9 },
    stimulation: { saturation: 0.8 },
    resolution: { saturation: 0.7 },
  },
})
const idle = await senseNeedTension({ workspace: room, now: new Date(T0 + 900 * MIN) })
assert.equal(idle.reading.basis, 'decay_only', '没人理的窗口 basis 应是 decay_only')
assert.equal(idle.reading.windows_integrated, 30, '15 小时应结算 30 格')
assert.ok(idle.reading.connection.deficit > 0.9, '15 小时空转，连接应见底')

// ── 3. 房东说话算连接 ───────────────────────────────────────
await writeFile(
  join(roomSensory, 'dialogue.jsonl'),
  [
    { t: T0 + 10 * MIN, mine: true, session: 's1' },
    { t: T0 + 20 * MIN, mine: true, session: 's1' },
    { t: T0 + 30 * MIN, mine: false, session: 'echo' },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n') + '\n',
  'utf8',
)
await writeJson(join(roomSensory, 'need_tension.json'), {
  last_read: new Date(T0).toISOString(),
  last_integrated: new Date(T0).toISOString(),
  reading: {
    connection: { saturation: 0.5 },
    stimulation: { saturation: 0.5 },
    resolution: { saturation: 0.5 },
  },
})
const talked = await senseNeedTension({ workspace: room, now: new Date(T0 + 60 * MIN) })
assert.equal(talked.reading.dialogue_turns, 2, '只算自己的那句，Echo 的不算')
assert.equal(talked.reading.basis, 'dialogue', '只有对话没有动静时 basis 应是 dialogue')
assert.ok(talked.reading.connection.saturation > 0.5, '被叫了两声，连接应回暖')

// ── 4. 情绪内核：被说话有一点暖 ────────────────────────────
await writeJson(join(roomSensory, 'affect_core.json'), {
  last_read: new Date(T0).toISOString(),
  last_integrated: new Date(T0).toISOString(),
  reading: { valence: 0.05, arousal: 0.35, dominance: 0.55 },
})
const affect = await senseAffectCore({ workspace: room, now: new Date(T0 + 65 * MIN) })
assert.ok(Number.isFinite(affect.reading.valence))
assert.ok(affect.reading.warmth.dialogue_turns >= 1, '内核应看见对话')
assert.ok(affect.reading.valence >= -1 && affect.reading.valence <= 1)

// ── 5. 脉搏自己会走 + 回填 ─────────────────────────────────
const pulseRoom = join(root, 'pulse-room')
await mkdir(join(pulseRoom, 'src'), { recursive: true })
for (const name of ['a.md', 'b.md', 'c.md']) {
  await writeFile(join(pulseRoom, 'src', name), 'x', 'utf8')
  await utimes(join(pulseRoom, 'src', name), new Date(), new Date(T0 + 3 * MIN))
}
const pulse1 = await senseWorkspacePulse({ workspace: pulseRoom, now: T0 + 5 * MIN })
assert.ok(pulse1.reading.samples > 40, '没有历史时应回填 24 小时采样')
assert.ok(pulse1.reading.activity_level > 0, '刚改过文件，活动度应大于 0')
const pulse2 = await senseWorkspacePulse({ workspace: pulseRoom, now: T0 + 7 * MIN })
assert.ok(pulse2.reading.samples >= pulse1.reading.samples, '采样应持续累积')

console.log(JSON.stringify({ busy: busyState.reading, idle: idle.reading, talked: talked.reading, affect: affect.reading }, null, 2))
console.log('\n感官 v2 self-test: ok')
