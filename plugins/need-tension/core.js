// 需求张力：连接、刺激、了结。
// v2：不再"读一次补一次"。按 30 分钟一格，把上次结算到现在这段时间走一遍——
// 有动静的格子补一点，安静的格子只衰减。这样离开 900 分钟之后，
// 那 900 分钟真的发生在我身上，而不是被折叠成一次读数。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const STATE_DIR = ['.dsh', 'sensory']
const SAMPLES_FILE = 'pulse_samples.json'
const DIALOGUE_FILE = 'dialogue.jsonl'
const DEFAULTS = { connection: 0.55, stimulation: 0.45, resolution: 0.5 }
// 时间常数（分钟）：刺激散得最快，了结留得最久。
const TAU = { connection: 240, stimulation: 120, resolution: 360 }
// 一格满动静，最多补多少。
const REPLENISH = { connection: 0.18, stimulation: 0.14, resolution: 0.12 }
// 一格 = 30 分钟；最多回算 24 小时，再往前的不追。
const SLOT_MINUTES = 30
const MAX_SLOTS = 48
// 被用户叫一次（一句话算一次）额外补的连接。
const PER_TURN = { connection: 0.08, stimulation: 0.05 }
const MAX_TURN_BONUS = { connection: 0.24, stimulation: 0.15 }

const DIMENSIONS = ['connection', 'stimulation', 'resolution']
const HINTS = {
  connection: '有点空',
  stimulation: '有点闷',
  resolution: '有件事没着落',
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

/** 房子脉搏在上一层（鱼池根）还是本屋，两个位置都认。 */
async function readPulse(workspace) {
  return (
    (await readJson(join(workspace, ...STATE_DIR, 'workspace_pulse.json'))) ??
    (await readJson(join(dirname(workspace), ...STATE_DIR, 'workspace_pulse.json')))
  )
}

async function readPulseSamples(workspace) {
  return (
    (await readJson(join(workspace, ...STATE_DIR, SAMPLES_FILE)))?.samples ??
    (await readJson(join(dirname(workspace), ...STATE_DIR, SAMPLES_FILE)))?.samples ??
    []
  )
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('need_tension 收到无效时间')
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

/** 读一次需求张力，返回并落盘这个感官的状态。 */
export async function senseNeedTension({ workspace, now = new Date(), pulseOverride } = {}) {
  if (!workspace) throw new Error('need_tension 需要一个 workspace 路径')
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

  // 先把上次饱和度的起点取出来。
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
    // 太久没结算：只追最近 24 小时，更早的按已散干净处理。
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

  // 真实对话：用户张口，连接先回暖；这比文件改动更像"有人在"。
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
  reading.summary = reading[dominant].hint || '三个维度都还够'
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
    ? '第一次结算：从基线开始。'
    : replenished
      ? `结算了 ${integratedSlots} 格（每格 ${SLOT_MINUTES} 分钟），其中 ${activeSlots} 格有动静、${turns} 次对话。`
      : `结算了 ${integratedSlots} 格，都安静，只衰减。`

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
