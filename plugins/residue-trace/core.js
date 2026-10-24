// 情绪残留：把 affect_core 的快照攒成一小段历史，再算"现在还剩下多少余味"。
// 强情绪衰减慢，小波动很快归零。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STATE_DIR = ['.dsh', 'sensory']
const HISTORY_LIMIT = 50
const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round = (n, digits = 3) => Number(n.toFixed(digits))

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function labelFor(valence, arousal) {
  if (valence <= -0.25 && arousal >= 0.55) return 'tense'
  if (valence <= -0.25) return 'low'
  if (valence >= 0.3 && arousal >= 0.55) return 'bright'
  if (valence >= 0.2) return 'warm'
  return 'neutral'
}

/** 读一次残留，返回并落盘这个感官的状态。 */
export async function senseResidueTrace({ workspace, now = new Date(), affectOverride } = {}) {
  if (!workspace) throw new Error('residue_trace 需要一个 workspace 路径')
  const nowDate = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(nowDate.getTime())) throw new Error('residue_trace 收到无效时间')

  const statePath = join(workspace, ...STATE_DIR, 'residue_trace.json')
  const previous = await readJson(statePath)
  const affect = affectOverride ?? (await readJson(join(workspace, ...STATE_DIR, 'affect_core.json')))
  const history = Array.isArray(previous?.history) ? previous.history.slice(-HISTORY_LIMIT) : []

  const baseline = affect?.baseline ?? { valence: 0.05, arousal: 0.35, dominance: 0.55 }
  const valence = Number.isFinite(affect?.reading?.valence) ? affect.reading.valence : baseline.valence
  const arousal = Number.isFinite(affect?.reading?.arousal) ? affect.reading.arousal : baseline.arousal
  const dominance = Number.isFinite(affect?.reading?.dominance)
    ? affect.reading.dominance
    : baseline.dominance

  const deviation = Number.isFinite(affect?.drift)
    ? affect.drift
    : (Math.abs(valence - baseline.valence) / 2 +
        Math.abs(arousal - baseline.arousal) +
        Math.abs(dominance - baseline.dominance)) /
      3
  const shock = clamp01(deviation / 0.5)

  const last = history[history.length - 1]
  const shouldAppend =
    Boolean(affect) &&
    (!last ||
      nowDate.getTime() - new Date(last.at).getTime() >= 60_000 ||
      Math.abs(last.shock - shock) > 0.1)

  if (shouldAppend) {
    history.push({
      at: nowDate.toISOString(),
      valence: round(valence),
      arousal: round(arousal),
      dominance: round(dominance),
      shock: round(shock),
    })
  }
  while (history.length > HISTORY_LIMIT) history.shift()

  const contributions = history
    .map((event) => {
      const ageMinutes = Math.max(0, (nowDate.getTime() - new Date(event.at).getTime()) / 60000)
      // 强情绪留得久，小波动散得快。
      const tau = event.shock >= 0.5 ? 360 : event.shock >= 0.25 ? 180 : 45
      return {
        ...event,
        age_minutes: round(ageMinutes, 1),
        contribution: round(event.shock * Math.exp(-ageMinutes / tau)),
      }
    })
    .filter((event) => event.contribution > 0.01)
    .sort((a, b) => b.contribution - a.contribution)

  const lingering = clamp01(contributions.reduce((sum, event) => sum + event.contribution, 0))
  const dominant = contributions[0] ?? null

  const reading = {
    lingering: round(lingering),
    dominant_residue: dominant ? labelFor(dominant.valence, dominant.arousal) : 'none',
    active_events: contributions.length,
    top_contributions: contributions.slice(0, 3).map((event) => ({
      at: event.at,
      age_minutes: event.age_minutes,
      shock: event.shock,
      contribution: event.contribution,
    })),
    history_size: history.length,
    scanned_at: nowDate.toISOString(),
  }

  const state = {
    sense: 'residue_trace',
    active: true,
    last_read: reading.scanned_at,
    reading,
    baseline: { lingering: 0 },
    drift: round(lingering),
    history,
    notes: dominant ? '' : '还没有足够的历史，余味为 0。',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
