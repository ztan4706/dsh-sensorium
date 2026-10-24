// 神情：眼睛、眉、嘴角，还有藏不住的那一下。
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

const EYES = { half: '眼睛半阖', level: '眼睛平视', wide: '眼睛睁圆', narrow: '眼睛眯着', away: '目光偏开' }
const BROWS = { relaxed: '眉是松的', knit: '眉皱起来', raised: '眉挑了一下' }
const MOUTH = { relaxed: '嘴角松着', flat: '嘴角平着', corner: '嘴角翘了一点', pressed: '嘴角压着', open: '嘴张开了一点' }

/** 读一次神情，返回并落盘这个感官的状态。 */
export async function senseFace({ workspace, affectOverride, biasOverride, needOverride } = {}) {
  if (!workspace) throw new Error('face 需要一个 workspace 路径')

  const affect = affectOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'affect_core.json')))
  const bias = biasOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'expression_bias.json')))
  const need = needOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'need_tension.json')))
  const previous = await readJson(join(workspace, ...STATE_DIR, 'face.json'))

  const valence = num(affect?.reading?.valence, 0)
  const arousal = num(affect?.reading?.arousal, 0.35)
  const dominance = num(affect?.reading?.dominance, 0.55)
  const mask = bias?.reading?.mask ?? 'none'
  const maskScore = num(bias?.reading?.mask_score, 0)
  const connection = num(need?.reading?.connection?.deficit, 0.4)

  const eyes =
    mask === 'strong' && arousal >= 0.5
      ? 'narrow'
      : valence <= -0.3
        ? dominance >= 0.55
          ? 'narrow'
          : 'away'
        : valence >= 0.45
          ? arousal >= 0.55
            ? 'wide'
            : 'half'
          : arousal <= 0.28
            ? 'half'
            : 'level'

  const brows = valence >= 0.35 ? 'raised' : valence <= -0.25 && arousal >= 0.5 ? 'knit' : 'relaxed'

  const mouth =
    mask === 'strong' && valence < -0.1
      ? 'pressed'
      : valence >= 0.65 && arousal >= 0.6
        ? 'open'
        : valence >= 0.4
          ? 'corner'
          : valence <= -0.3
            ? 'flat'
            : 'relaxed'

  // 被夸、被看见的时候，耳朵尖会热。掩蔽只能压住一部分。
  const rawWarmth = clamp01(0.55 * Math.max(0, valence) + 0.3 * connection + 0.15 * (1 - dominance))
  let warmth = rawWarmth
  if (mask === 'strong') warmth = clamp01(warmth * 0.6)
  else if (mask === 'light') warmth = clamp01(warmth * 0.85)

  const expression =
    mask === 'strong'
      ? 'guarded'
      : arousal <= 0.3
        ? 'soft'
        : valence >= 0.55
          ? 'amused'
          : valence >= 0.2
            ? 'warm'
            : valence <= -0.3
              ? 'withdrawn'
              : 'neutral'

  // 藏不住的那一下：强掩蔽时，眼睛压住了，身体先漏。
  const leak = mask === 'strong' && (rawWarmth >= 0.55 || arousal >= 0.6) ? (rawWarmth >= 0.55 ? '耳朵尖有一点热' : '眼神没跟上语气') : null

  const intensity = clamp01(0.4 * Math.abs(valence) + 0.3 * arousal + 0.3 * warmth)

  const previousReading = previous?.reading
  const changed =
    !previousReading ||
    previousReading.eyes !== eyes ||
    previousReading.brows !== brows ||
    previousReading.mouth !== mouth ||
    previousReading.expression !== expression

  const parts = [EYES[eyes], MOUTH[mouth]]
  if (Math.abs(valence) >= 0.35 || leak) parts.push(BROWS[brows])
  if (leak) parts.push(leak)

  const reading = {
    eyes,
    brows,
    mouth,
    expression,
    warmth: round(warmth),
    mask,
    mask_score: round(maskScore),
    leak,
    intensity: round(intensity),
    tell: parts.join('，'),
    changed: Boolean(changed),
    visible: Boolean(changed) || intensity >= 0.6,
    basis: { affect: Boolean(affect), bias: Boolean(bias), need: Boolean(need) },
    scanned_at: new Date().toISOString(),
  }

  const baseline = { eyes: 'level', mouth: 'relaxed', expression: 'neutral' }
  const state = {
    sense: 'face',
    active: true,
    last_read: reading.scanned_at,
    reading,
    baseline,
    drift: round(Math.abs(warmth - 0.3)),
    notes:
      mask === 'strong'
        ? '脸上收住了，只有很轻的一下漏出来。'
        : warmth >= 0.55
          ? '被看见了，耳朵在热。'
          : '脸上是松的。',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(join(workspace, ...STATE_DIR, 'face.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
