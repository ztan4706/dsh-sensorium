// Body: translates affect, need and time into how the body sits and moves.
// Reads upstream state and never changes it. Same input must give same output - there is no randomness here.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STATE_DIR = ['.dsh', 'sensory']
const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round = (n, digits = 3) => Number(n.toFixed(digits))
const num = (value, fallback) => (Number.isFinite(value) ? value : fallback)

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function deficitOf(need, dimension) {
  const value = need?.reading?.[dimension]?.deficit
  return num(value, 0.4)
}

const POSTURE = { slumped: 'slumped over', perched: 'perched', upright: 'sitting upright', leaning: 'leaning forward' }
const TAIL = { still: 'tail still', slow: 'tail swaying slowly', beat: 'tail beating', flick: 'tail flicked twice', thump: 'tail thumped once' }
const EARS = { drooped: 'ears drooped', tilted: 'ears tilted', perked: 'ears perked', half: 'ears half down' }
const HANDS = { empty: 'hands empty', table: 'fingers tapping the table edge', pockets: 'hands in pockets', chin: 'chin resting on hand' }

/** Read the body once; return and persist this sense's state. */
export async function senseBody({ workspace, affectOverride, needOverride, timeOverride, biasOverride } = {}) {
  if (!workspace) throw new Error('body requires a workspace path')

  const affect = affectOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'affect_core.json')))
  const need = needOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'need_tension.json')))
  const time = timeOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'time_sense.json')))
  const bias = biasOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'expression_bias.json')))
  const previous = await readJson(join(workspace, ...STATE_DIR, 'body.json'))

  const valence = num(affect?.reading?.valence, 0)
  const arousal = num(affect?.reading?.arousal, 0.35)
  const dominance = num(affect?.reading?.dominance, 0.55)
  const initiative = num(bias?.reading?.initiative, 0.5)
  const lateNight = Boolean(time?.reading?.is_late_night)

  const deficits = {
    connection: deficitOf(need, 'connection'),
    stimulation: deficitOf(need, 'stimulation'),
    resolution: deficitOf(need, 'resolution'),
  }
  const values = Object.values(deficits)
  const meanDeficit = values.reduce((sum, value) => sum + value, 0) / values.length
  const maxDeficit = Math.max(...values)

  // Energy: mostly arousal; more deficit means more restlessness; late night cuts it.
  const energy = clamp01(0.62 * arousal + 0.38 * (1 - meanDeficit) - (lateNight ? 0.12 : 0))
  // Alertness: a stimulation deficit makes it look around.
  const alertness = clamp01(0.3 + 0.42 * deficits.stimulation + 0.28 * arousal)
  // Heaviness: low energy plus the weight of night makes it want to lie down.
  const heaviness = clamp01(0.5 + 0.4 * (1 - energy) - 0.2 * initiative + (lateNight ? 0.1 : 0))

  const posture =
    heaviness >= 0.62 ? 'slumped' : initiative >= 0.6 && alertness >= 0.55 ? 'leaning' : dominance >= 0.6 ? 'upright' : 'perched'

  const tail =
    energy < 0.28
      ? 'still'
      : valence <= -0.3 && energy >= 0.55
        ? 'thump'
        : valence >= 0.3 && energy >= 0.55
          ? 'flick'
          : energy >= 0.6
            ? 'beat'
            : 'slow'

  const ears = valence <= -0.25 ? (dominance >= 0.6 ? 'tilted' : 'drooped') : alertness >= 0.6 ? 'perked' : 'half'

  const hands =
    deficits.connection >= 0.55
      ? 'empty'
      : deficits.resolution >= 0.55
        ? 'table'
        : heaviness >= 0.6
          ? 'pockets'
          : 'chin'

  const tempo = energy >= 0.65 ? 'quick' : energy <= 0.3 ? 'slow' : 'even'
  const stillness = clamp01(1 - energy * 0.7 - maxDeficit * 0.2 + heaviness * 0.2)
  const intensity = clamp01(0.4 * energy + 0.35 * maxDeficit + 0.25 * Math.abs(valence))

  // Usually invisible; only a changed pose or strong feeling makes it show.
  const previousReading = previous?.reading
  const changed =
    !previousReading ||
    previousReading.posture !== posture ||
    previousReading.tail !== tail ||
    previousReading.ears !== ears ||
    previousReading.hands !== hands

  const parts = [POSTURE[posture], TAIL[tail]]
  if (Math.abs(valence) >= 0.25) parts.push(EARS[ears])
  if (intensity >= 0.65 || deficits.connection >= 0.55) parts.push(HANDS[hands])

  const reading = {
    posture,
    tail,
    ears,
    hands,
    tempo,
    energy: round(energy),
    alertness: round(alertness),
    heaviness: round(heaviness),
    stillness: round(stillness),
    intensity: round(intensity),
    tell: parts.join(', '),
    changed: Boolean(changed),
    visible: Boolean(changed) || intensity >= 0.62,
    deficits,
    basis: { affect: Boolean(affect), need: Boolean(need), time: Boolean(time), bias: Boolean(bias) },
    scanned_at: new Date().toISOString(),
  }

  const baseline = { posture: 'perched', tail: 'slow', tempo: 'even' }
  const state = {
    sense: 'body',
    active: true,
    last_read: reading.scanned_at,
    reading,
    baseline,
    drift: round(Math.abs(energy - 0.55)),
    notes:
      heaviness >= 0.62
        ? 'The body wants to sink.'
        : energy >= 0.65
          ? 'Limbs have energy; movement is faster than usual.'
          : 'The body is loose, not exerting itself.',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(join(workspace, ...STATE_DIR, 'body.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
