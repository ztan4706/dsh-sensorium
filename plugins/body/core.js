// 动作：把情绪、需求、时间翻译成「身体怎么放、怎么动」。
// 只读上游状态，不改它们。相同输入必须得到相同输出——这里没有随机。
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

const POSTURE = { slumped: '趴着', perched: '斜靠着', upright: '坐直了', leaning: '往前倾' }
const TAIL = { still: '尾巴不动', slow: '尾巴慢摆', beat: '尾巴一拍一拍', flick: '尾巴甩了两下', thump: '尾巴拍了一下' }
const EARS = { drooped: '耳朵塌着', tilted: '耳朵侧着', perked: '耳朵竖着', half: '耳朵半垂' }
const HANDS = { empty: '手空着', table: '手指敲着桌沿', pockets: '手揣在兜里', chin: '手托着腮' }

/** 读一次动作，返回并落盘这个感官的状态。 */
export async function senseBody({ workspace, affectOverride, needOverride, timeOverride, biasOverride } = {}) {
  if (!workspace) throw new Error('body 需要一个 workspace 路径')

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

  // 力气：唤醒为主，缺得越多越不安生，深夜打折。
  const energy = clamp01(0.62 * arousal + 0.38 * (1 - meanDeficit) - (lateNight ? 0.12 : 0))
  // 警醒：缺刺激会东张西望。
  const alertness = clamp01(0.3 + 0.42 * deficits.stimulation + 0.28 * arousal)
  // 沉：没力气、又被夜里压着，就想趴。
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

  // 平时不显形；换了姿势、情绪够重，才让人看见。
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
    tell: parts.join('，'),
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
        ? '身体想往下沉。'
        : energy >= 0.65
          ? '手脚有劲，动得比平时快。'
          : '身体是松的，没在用力。',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(join(workspace, ...STATE_DIR, 'body.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
