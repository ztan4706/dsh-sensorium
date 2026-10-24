// Silence gate: reads initiative, time and workspace activity to decide whether to speak.
// This is advice, not a command; allowing silence is the reason this sense exists.
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

/** Read the silence gate once; return and persist this sense's state. */
export async function senseSilenceGate({
  workspace,
  expressionOverride,
  timeOverride,
  pulseOverride,
} = {}) {
  if (!workspace) throw new Error('silence_gate requires a workspace path')

  const expression =
    expressionOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'expression_bias.json')))
  const time = timeOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'time_sense.json')))
  // The house pulse lives at the pond root, or possibly in this room; both locations count.
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
    // The other side is busy; do not interrupt even if inclined to speak.
    staySilent = true
    reason = 'The other side is busy; do not interrupt.'
    confidence = 0.85
  } else if (isLateNight && initiative < 0.85) {
    staySilent = true
    reason = 'Too late unless it matters.'
    confidence = 0.8
  } else if (initiative < 0.35) {
    staySilent = true
    reason = 'Not much urge to speak.'
    confidence = 0.75
  } else if (elapsed < 2 && activity >= 0.4) {
    staySilent = true
    reason = 'Just spoke; do not push.'
    confidence = 0.7
  } else if (initiative >= 0.7) {
    staySilent = false
    reason = 'Want to speak, and the other side is not busy.'
    confidence = 0.8
  } else if (initiative >= 0.5) {
    staySilent = false
    reason = 'Can speak, but no rush.'
    confidence = 0.6
  } else {
    staySilent = true
    reason = 'Wait a little longer.'
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
    notes: 'This is advice, not a command. Choosing silence is a normal output.',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(join(workspace, ...STATE_DIR, 'silence_gate.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
