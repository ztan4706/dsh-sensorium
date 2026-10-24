// Senses v2 self-test: checks that time actually passes through me.
// Usage: node tests/selftest.mjs
// Everything runs in temp directories, never real state.
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

// -- 1. Ten busy hours must be replenished -----------------------------
const busy = slotsBetween(T0, T0 + 600 * MIN, 0.6)
await writeJson(join(roomSensory, 'pulse_samples.json'), { samples: busy })
await writeJson(join(roomSensory, 'workspace_pulse.json'), {
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
assert.equal(busyState.reading.basis, 'samples', 'a busy window should have basis samples')
assert.equal(busyState.reading.windows_integrated, 20, '10 hours should settle 20 slots')
assert.ok(busyState.reading.active_windows >= 19, 'most slots should be active')
assert.ok(busyState.reading.connection.saturation > 0.5, 'after a busy day, connection should not be empty')

// -- 2. Fifteen idle hours decay only ---------------------------------
await writeFile(join(roomSensory, 'pulse_samples.json'), JSON.stringify({ samples: [] }), 'utf8')
// A pulse one level up must be ignored: each sense reads only its own workspace.
await writeJson(join(houseSensory, 'pulse_samples.json'), { samples: busy })
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
assert.equal(idle.reading.basis, 'decay_only', 'an untouched window should have basis decay_only')
assert.equal(idle.reading.windows_integrated, 30, '15 hours should settle 30 slots')
assert.ok(idle.reading.connection.deficit > 0.9, 'after 15 idle hours, connection should bottom out')

// -- 3. The user speaking counts as connection -----------------------
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
assert.equal(talked.reading.dialogue_turns, 2, 'only my own turns count, not the turns from Echo')
assert.equal(talked.reading.basis, 'dialogue', 'dialogue without activity should have basis dialogue')
assert.ok(talked.reading.connection.saturation > 0.5, 'after two calls, connection should warm')

// -- 4. Affect core: being spoken to leaves a little warmth ------------
await writeJson(join(roomSensory, 'affect_core.json'), {
  last_read: new Date(T0).toISOString(),
  last_integrated: new Date(T0).toISOString(),
  reading: { valence: 0.05, arousal: 0.35, dominance: 0.55 },
})
const affect = await senseAffectCore({ workspace: room, now: new Date(T0 + 65 * MIN) })
assert.ok(Number.isFinite(affect.reading.valence))
assert.ok(affect.reading.warmth.dialogue_turns >= 1, 'the core should see the dialogue')
assert.ok(affect.reading.valence >= -1 && affect.reading.valence <= 1)

// -- 5. The pulse runs on its own + backfill -------------------------
const pulseRoom = join(root, 'pulse-room')
await mkdir(join(pulseRoom, 'src'), { recursive: true })
for (const name of ['a.md', 'b.md', 'c.md']) {
  await writeFile(join(pulseRoom, 'src', name), 'x', 'utf8')
  await utimes(join(pulseRoom, 'src', name), new Date(), new Date(T0 + 3 * MIN))
}
const pulse1 = await senseWorkspacePulse({ workspace: pulseRoom, now: T0 + 5 * MIN })
assert.ok(pulse1.reading.samples > 40, 'without history it should backfill 24 hours of samples')
assert.ok(pulse1.reading.activity_level > 0, 'files just changed, so activity should be above 0')
const pulse2 = await senseWorkspacePulse({ workspace: pulseRoom, now: T0 + 7 * MIN })
assert.ok(pulse2.reading.samples >= pulse1.reading.samples, 'samples should keep accumulating')

console.log(JSON.stringify({ busy: busyState.reading, idle: idle.reading, talked: talked.reading, affect: affect.reading }, null, 2))
console.log('\nsenses v2 self-test: ok')
