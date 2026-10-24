// 表达偏置：把 affect_core 和 need_tension 翻译成"怎么说"的倾向。
// 只读上游状态，不改它们。相同输入必须得到相同输出——这里没有随机。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

function toneFor(valence, arousal) {
  if (valence <= -0.25 && arousal >= 0.55) return 'terse'
  if (valence <= -0.25) return 'withdrawn'
  if (valence >= 0.3 && arousal >= 0.55) return 'playful'
  if (valence >= 0.2) return 'warm'
  return 'neutral'
}

function deficitOf(need, dimension) {
  const value = need?.reading?.[dimension]?.deficit
  return Number.isFinite(value) ? value : 0.4
}

/** 读一次表达偏置，返回并落盘这个感官的状态。 */
export async function senseExpressionBias({ workspace, affectOverride, needOverride } = {}) {
  if (!workspace) throw new Error('expression_bias 需要一个 workspace 路径')

  const affect = affectOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'affect_core.json')))
  const need = needOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'need_tension.json')))

  const valence = Number.isFinite(affect?.reading?.valence) ? affect.reading.valence : 0
  const arousal = Number.isFinite(affect?.reading?.arousal) ? affect.reading.arousal : 0.35
  const dominance = Number.isFinite(affect?.reading?.dominance) ? affect.reading.dominance : 0.55

  const deficits = {
    connection: deficitOf(need, 'connection'),
    stimulation: deficitOf(need, 'stimulation'),
    resolution: deficitOf(need, 'resolution'),
  }
  const values = Object.values(deficits)
  const meanDeficit = values.reduce((sum, value) => sum + value, 0) / values.length
  const dominantDeficit = Object.entries(deficits).sort((a, b) => b[1] - a[1])[0][0]

  const underlyingTone = toneFor(valence, arousal)

  // 口是心非的强度：内在越负、越能撑住，越可能把表情收起来。
  const maskScore = clamp01(Math.max(0, -valence) * (0.45 + 0.55 * dominance))
  const mask = maskScore >= 0.42 ? 'strong' : maskScore >= 0.18 ? 'light' : 'none'

  let tone = underlyingTone
  if (mask === 'strong') {
    // 强掩蔽时，外面可以是 neutral，甚至在缺连接时反而更 warm。
    tone = deficits.connection > 0.55 ? 'warm' : 'neutral'
  } else if (mask === 'light' && (underlyingTone === 'terse' || underlyingTone === 'withdrawn')) {
    tone = 'neutral'
  }

  let initiative = clamp01(
    0.15 + 0.45 * meanDeficit + 0.25 * Math.max(...values) + 0.1 * ((valence + 1) / 2) + 0.05 * arousal,
  )
  if (mask === 'strong') initiative = clamp01(initiative - 0.15)
  else if (mask === 'light') initiative = clamp01(initiative - 0.05)

  const reading = {
    tone,
    underlying_tone: underlyingTone,
    initiative: round(initiative),
    mask,
    mask_score: round(maskScore),
    deficits,
    dominant_deficit: dominantDeficit,
    basis: {
      affect: Boolean(affect),
      need: Boolean(need),
    },
    scanned_at: new Date().toISOString(),
  }

  const baseline = { tone: 'neutral', initiative: 0.5, mask: 'none' }
  const state = {
    sense: 'expression_bias',
    active: true,
    last_read: reading.scanned_at,
    reading,
    baseline,
    drift: round(Math.abs(reading.initiative - baseline.initiative)),
    notes:
      mask === 'strong'
        ? '内在偏负，但表达收住了。'
        : mask === 'light'
          ? '稍微收了一点。'
          : '里外基本一致。',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(join(workspace, ...STATE_DIR, 'expression_bias.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
