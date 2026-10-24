// Need tension: connection, stimulation, resolution.
// v2: no longer "one read, one refill". Walk the time since the last settle in 30-minute slots:
// active slots refill a little, quiet slots only decay. So after 900 minutes away,
// those 900 minutes actually happened to me instead of collapsing into one reading.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STATE_DIR = ['.dsh', 'sensory']
const SAMPLES_FILE = 'pulse_samples.json'
const DIALOGUE_FILE = 'dialogue.jsonl'
const DEFAULTS = { connection: 0.55, stimulation: 0.45, resolution: 0.5 }
// Time constants (minutes): stimulation fades fastest, resolution lingers longest.
const TAU = { connection: 240, stimulation: 120, resolution: 360 }
// Maximum refill for one fully active slot.
const REPLENISH = { connection: 0.18, stimulation: 0.14, resolution: 0.12 }
// One slot = 30 minutes; integrate at most 24 hours back, no further.
const SLOT_MINUTES = 30
const MAX_SLOTS = 48
// Extra connection for being called by the user (one turn counts once).
const PER_TURN = { connection: 0.08, stimulation: 0.05 }
const MAX_TURN_BONUS = { connection: 0.24, stimulation: 0.15 }

const DIMENSIONS = ['connection', 'stimulation', 'resolution']
const HINTS = {
  connection: 'A little empty',
  stimulation: 'A little bored',
  resolution: 'Something is unresolved',
}

const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round = (n, digits = 3) => Number(n.toFixed(digits))

function labelFor(saturation) {
  if (saturation >= 0.7) return 'full'
  if (saturation >= 0.4) return 'ok'
  return 'low'
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function readDialogue(file) {
  try {
    const text = await readFile(file, 'utf8')
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/** The pulse lives in this workspace's own state directory; nothing is read outside it. */
async function readPulse(workspace) {
  return readJson(join(workspace, ...STATE_DIR, 'workspace_pulse.json'))
}

async function readPulseSamples(workspace) {
  return (await readJson(join(workspace, ...STATE_DIR, SAMPLES_FILE)))?.samples ?? []
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('need_tension received an invalid time')
  return date
}

function slotActivity(samples, startMs, endMs) {
  let sum = 0
  let count = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample?.t) || !Number.isFinite(sample?.a)) continue
    if (sample.t >= startMs && sample.t < endMs) {
      sum += sample.a
      count += 1
    }
  }
  return count > 0 ? sum / count : 0
}

/** Read the need tension once; return and persist this sense's state. */
export async function senseNeedTension({ workspace, now = new Date(), pulseOverride } = {}) {
  if (!workspace) throw new Error('need_tension requires a workspace path')
  const nowDate = asDate(now)
  const nowMs = nowDate.getTime()

  const statePath = join(workspace, ...STATE_DIR, 'need_tension.json')
  const previous = await readJson(statePath)
  const pulse = pulseOverride ?? (await readPulse(workspace))
  const samples = Array.isArray(pulseOverride?.samples)
    ? pulseOverride.samples
    : await readPulseSamples(workspace)
  const dialogue = await readDialogue(join(workspace, ...STATE_DIR, DIALOGUE_FILE))

  const baseline = previous?.baseline ?? { ...DEFAULTS }
  const lastReadAt = previous?.last_integrated ?? previous?.last_read ?? null
  const lastRead = lastReadAt ? new Date(lastReadAt) : null
  const hasPrevious = Boolean(lastRead && !Number.isNaN(lastRead.getTime()))
  const elapsedMinutes = hasPrevious ? Math.max(0, (nowMs - lastRead.getTime()) / 60000) : 0

  // Start from the previous saturations.
  const saturations = {}
  for (const dimension of DIMENSIONS) {
    saturations[dimension] = Number.isFinite(previous?.reading?.[dimension]?.saturation)
      ? previous.reading[dimension].saturation
      : baseline[dimension]
  }

  let integratedSlots = 0
  let activeSlots = 0
  let cursor = hasPrevious ? lastRead.getTime() : nowMs
  const skippedMinutes = Math.max(0, (nowMs - cursor) / 60000 - MAX_SLOTS * SLOT_MINUTES)
  if (hasPrevious && nowMs - cursor > MAX_SLOTS * SLOT_MINUTES * 60000) {
    // Too long since the last settle: integrate only the last 24 hours; older time is treated as fully decayed.
    cursor = nowMs - MAX_SLOTS * SLOT_MINUTES * 60000
  }

  while (cursor < nowMs) {
    const end = Math.min(nowMs, cursor + SLOT_MINUTES * 60000)
    const minutes = (end - cursor) / 60000
    const activity = slotActivity(samples, cursor, end)
    for (const dimension of DIMENSIONS) {
      saturations[dimension] *= Math.exp(-minutes / TAU[dimension])
      if (activity >= 0.2) {
        saturations[dimension] +=
          activity * REPLENISH[dimension] * (minutes / SLOT_MINUTES)
      }
    }
    integratedSlots += 1
    if (activity >= 0.2) activeSlots += 1
    cursor = end
  }

  // Real dialogue: when the user speaks, connection warms first; that is more "someone is here" than file changes.
  const turns = hasPrevious
    ? dialogue.filter((entry) => entry?.t > lastRead.getTime() && entry.t <= nowMs && entry.mine !== false).length
    : 0
  if (turns > 0) {
    saturations.connection = clamp01(
      saturations.connection + Math.min(MAX_TURN_BONUS.connection, PER_TURN.connection * turns),
    )
    saturations.stimulation = clamp01(
      saturations.stimulation + Math.min(MAX_TURN_BONUS.stimulation, PER_TURN.stimulation * turns),
    )
  }

  const reading = {}
  for (const dimension of DIMENSIONS) {
    const saturation = clamp01(saturations[dimension])
    reading[dimension] = {
      saturation: round(saturation),
      deficit: round(1 - saturation),
      label: labelFor(saturation),
      hint: saturation < 0.4 ? HINTS[dimension] : '',
    }
  }

  const dominant = DIMENSIONS.reduce((best, dimension) =>
    reading[dimension].deficit > reading[best].deficit ? dimension : best,
  )

  const replenished = activeSlots > 0 || turns > 0
  reading.dominant_deficit = dominant
  reading.summary = reading[dominant].hint || 'All three dimensions are satisfied.'
  reading.basis = !hasPrevious
    ? 'baseline'
    : replenished
      ? turns > 0 && activeSlots === 0
        ? 'dialogue'
        : 'samples'
      : 'decay_only'
  reading.windows_integrated = integratedSlots
  reading.active_windows = activeSlots
  reading.dialogue_turns = turns
  reading.elapsed_since_last_read_minutes = round(elapsedMinutes, 1)
  reading.scanned_at = nowDate.toISOString()

  const drift = clamp01(
    DIMENSIONS.reduce(
      (sum, dimension) => sum + Math.abs(reading[dimension].saturation - baseline[dimension]),
      0,
    ) / DIMENSIONS.length,
  )

  const notes = !hasPrevious
    ? 'First settle: starting from baseline.'
    : replenished
      ? `Settled ${integratedSlots} slots (${SLOT_MINUTES} minutes each): ${activeSlots} active, ${turns} dialogue turns.`
      : `Settled ${integratedSlots} slots, all quiet, decay only.`

  const state = {
    sense: 'need_tension',
    active: true,
    last_read: reading.scanned_at,
    last_integrated: reading.scanned_at,
    reading,
    baseline,
    drift: round(drift),
    last_replenish_at: replenished
      ? reading.scanned_at
      : previous?.last_replenish_at ?? null,
    notes,
    skipped_minutes: skippedMinutes > 0 ? round(skippedMinutes, 1) : 0,
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
