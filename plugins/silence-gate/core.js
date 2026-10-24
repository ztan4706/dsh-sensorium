// 沉默闸门：读表达意愿、时间、工作区活跃度，决定"该不该开口"。
// 这不是命令，是建议；允许不开口，是这个感官存在的理由。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const STATE_DIR = ['.dsh', 'sensory']
const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round = (n, digits = 3) => Number(n.toFixed(digits))

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** 读一次沉默闸门，返回并落盘这个感官的状态。 */
export async function senseSilenceGate({
  workspace,
  expressionOverride,
  timeOverride,
  pulseOverride,
} = {}) {
  if (!workspace) throw new Error('silence_gate 需要一个 workspace 路径')

  const expression =
    expressionOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'expression_bias.json')))
  const time = timeOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'time_sense.json')))
  // 房子脉搏住在鱼池根，也可能在本屋；两个位置都认。
  const pulse =
    pulseOverride ??
    (await readJson(join(workspace, ...STATE_DIR, 'workspace_pulse.json'))) ??
    (await readJson(join(dirname(workspace), ...STATE_DIR, 'workspace_pulse.json')))

  const initiative = clamp01(
    Number.isFinite(expression?.reading?.initiative) ? expression.reading.initiative : 0.5,
  )
  const activity = clamp01(
    Number.isFinite(pulse?.reading?.activity_level) ? pulse.reading.activity_level : 0,
  )
  const elapsed = Number.isFinite(time?.reading?.elapsed_since_last_interaction)
    ? time.reading.elapsed_since_last_interaction
    : 0
  const isLateNight = Boolean(time?.reading?.is_late_night)
  const dayPhase = time?.reading?.day_phase ?? 'unknown'

  let staySilent
  let reason
  let confidence

  if (activity >= 0.7) {
    // 对方在忙，再想说话也先不打扰。
    staySilent = true
    reason = '对方在忙，不打扰。'
    confidence = 0.85
  } else if (isLateNight && initiative < 0.85) {
    staySilent = true
    reason = '太晚了，除非要紧。'
    confidence = 0.8
  } else if (initiative < 0.35) {
    staySilent = true
    reason = '没那么想说话。'
    confidence = 0.75
  } else if (elapsed < 2 && activity >= 0.4) {
    staySilent = true
    reason = '刚说过，别催。'
    confidence = 0.7
  } else if (initiative >= 0.7) {
    staySilent = false
    reason = '想说话，对方也不忙。'
    confidence = 0.8
  } else if (initiative >= 0.5) {
    staySilent = false
    reason = '可以开口，但不必急。'
    confidence = 0.6
  } else {
    staySilent = true
    reason = '再等等。'
    confidence = 0.55
  }

  const reading = {
    should_speak: !staySilent,
    should_stay_silent: staySilent,
    reason,
    confidence: round(confidence, 2),
    inputs: {
      initiative: round(initiative),
      activity_level: round(activity),
      elapsed_since_last_interaction: elapsed,
      is_late_night: isLateNight,
      day_phase: dayPhase,
    },
    scanned_at: new Date().toISOString(),
  }

  const state = {
    sense: 'silence_gate',
    active: true,
    last_read: reading.scanned_at,
    reading,
    baseline: { initiative: 0.5 },
    drift: round(Math.abs(initiative - 0.5)),
    notes: '这是建议，不是命令。选择不开口，是正常输出。',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(join(workspace, ...STATE_DIR, 'silence_gate.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
