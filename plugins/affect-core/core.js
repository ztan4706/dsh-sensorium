// 效价-唤醒-支配度内核。
// v2：不再只看"此刻"——从上次结算到现在这段窗口里的平均动静才算环境，
// 用户说过话会留一点暖。衰减仍是闭式，所以离开多久都算得清。
// 不根据"当前这句话"跳变——这是内部状态，不是台词。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const STATE_DIR = ['.dsh', 'sensory']
const SAMPLES_FILE = 'pulse_samples.json'
const DIALOGUE_FILE = 'dialogue.jsonl'
const DEFAULTS = { valence: 0.05, arousal: 0.35, dominance: 0.55 }
// 衰减时间常数（分钟）：唤醒散得最快，效价留得最久。
const TAU = { valence: 180, arousal: 45, dominance: 120 }
const AXES = ['valence', 'arousal', 'dominance']
// 环境扰动刻意做小：窗户里的温度一天最多摇 ±0.05。
const MAX_PERTURBATION = 0.05

const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const clamp01 = (n) => clamp(n, 0, 1)
const round = (n, digits = 3) => Number(n.toFixed(digits))

function labelFor(valence, arousal) {
  if (valence > 0.25 && arousal < 0.4) return 'calm'
  if (valence > 0.25) return 'bright'
  if (valence < -0.2 && arousal > 0.5) return 'tense'
  if (valence < -0.2) return 'low'
  return 'neutral'
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

function windowActivity(samples, startMs, endMs) {
  let sum = 0
  let count = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample?.t) || !Number.isFinite(sample?.a)) continue
    if (sample.t > startMs && sample.t <= endMs) {
      sum += sample.a
      count += 1
    }
  }
  return count > 0 ? sum / count : null
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('affect_core 收到无效时间')
  return date
}

/** 读一次内核，返回并落盘这个感官的状态。 */
export async function senseAffectCore({ workspace, now = new Date(), baseline: baselineOverride } = {}) {
  if (!workspace) throw new Error('affect_core 需要一个 workspace 路径')
  const nowDate = asDate(now)
  const nowMs = nowDate.getTime()

  const statePath = join(workspace, ...STATE_DIR, 'affect_core.json')
  const previous = await readJson(statePath)
  const pulse = await readPulse(workspace)
  const samples = await readPulseSamples(workspace)
  const dialogue = await readDialogue(join(workspace, ...STATE_DIR, DIALOGUE_FILE))

  const baseline = previous?.baseline ?? { ...DEFAULTS, ...(baselineOverride ?? {}) }
  const previousReading = previous?.reading
  const lastReadAt = previous?.last_integrated ?? previous?.last_read ?? null
  const lastRead = lastReadAt ? new Date(lastReadAt) : null
  const hasPrevious = Boolean(lastRead && !Number.isNaN(lastRead.getTime()))
  const elapsedMinutes = hasPrevious ? Math.max(0, (nowMs - lastRead.getTime()) / 60000) : 0

  const decayed = {}
  for (const axis of AXES) {
    const previousValue = Number.isFinite(previousReading?.[axis]) ? previousReading[axis] : baseline[axis]
    decayed[axis] = baseline[axis] + (previousValue - baseline[axis]) * Math.exp(-elapsedMinutes / TAU[axis])
  }

  // 环境扰动代理：这段窗口平均有多热闹。没有采样时退回"此刻"的读数。
  const windowAverage = hasPrevious ? windowActivity(samples, lastRead.getTime(), nowMs) : null
  const currentActivity = Number.isFinite(pulse?.reading?.activity_level) ? pulse.reading.activity_level : 0
  const currentQuiet = Number.isFinite(pulse?.reading?.quiet_minutes) ? pulse.reading.quiet_minutes : Infinity
  const strength = windowAverage ?? (currentQuiet <= 10 ? currentActivity : 0)

  const turns = hasPrevious
    ? dialogue.filter((entry) => entry?.t > lastRead.getTime() && entry.t <= nowMs && entry.mine !== false).length
    : 0

  const perturbation = {
    source: windowAverage === null ? 'workspace_now' : 'workspace_window',
    strength: round(strength, 2),
    valence: round(clamp((strength - 0.25) * 0.02, -MAX_PERTURBATION, MAX_PERTURBATION), 3),
    arousal: round(clamp(strength * 0.03, -MAX_PERTURBATION, MAX_PERTURBATION), 3),
    dominance: round(clamp(-strength * 0.01, -MAX_PERTURBATION, MAX_PERTURBATION), 3),
  }

  const warmth = {
    dialogue_turns: turns,
    valence: round(Math.min(0.02, 0.005 * turns), 3),
    arousal: round(Math.min(0.015, 0.004 * turns), 3),
  }

  const reading = {
    valence: round(clamp(decayed.valence + perturbation.valence + warmth.valence, -1, 1)),
    arousal: round(clamp01(decayed.arousal + perturbation.arousal + warmth.arousal)),
    dominance: round(clamp01(decayed.dominance + perturbation.dominance)),
    label: '',
    elapsed_since_last_read_minutes: round(elapsedMinutes, 1),
    perturbation,
    warmth,
    scanned_at: nowDate.toISOString(),
  }
  reading.label = labelFor(reading.valence, reading.arousal)

  const drift = clamp01(
    (Math.abs(reading.valence - baseline.valence) / 2 +
      Math.abs(reading.arousal - baseline.arousal) +
      Math.abs(reading.dominance - baseline.dominance)) /
      3,
  )

  const state = {
    sense: 'affect_core',
    active: true,
    last_read: reading.scanned_at,
    last_integrated: reading.scanned_at,
    reading,
    baseline,
    drift: round(drift),
    notes: !hasPrevious
      ? '首次读数：以内核基线为起点。'
      : windowAverage === null
        ? '没有采样，环境只用此刻的读数。'
        : '',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
