// 时间感：本地时钟 + 工作区安静时长。
// 只读 workspace_pulse 的状态文件，不写它。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const STATE_DIR = ['.dsh', 'sensory']
const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round = (n, digits = 2) => Number(n.toFixed(digits))

function phaseFor(hour) {
  if (hour >= 6 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'night'
}

function localDate(now) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** 读一次时间感，返回并落盘这个感官的状态。 */
export async function senseTimeSense({ workspace, now = new Date() } = {}) {
  if (!workspace) throw new Error('time_sense 需要一个 workspace 路径')
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('time_sense 收到无效时间')

  // 房子脉搏住在鱼池根，也可能在本屋；两个位置都认。
  const pulse =
    (await readJson(join(workspace, ...STATE_DIR, 'workspace_pulse.json'))) ??
    (await readJson(join(dirname(workspace), ...STATE_DIR, 'workspace_pulse.json')))
  const quietMinutes = Number.isFinite(pulse?.reading?.quiet_minutes) ? pulse.reading.quiet_minutes : null
  const lastActivityAt = quietMinutes === null ? null : new Date(now.getTime() - quietMinutes * 60000)

  const hour = now.getHours()
  const minute = now.getMinutes()
  const dayPhase = phaseFor(hour)
  const isLateNight = hour >= 23 || hour < 6

  const reading = {
    local_hour: hour,
    local_minute: minute,
    local_time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    day_phase: dayPhase,
    is_late_night: isLateNight,
    elapsed_since_last_interaction: quietMinutes === null ? null : round(quietMinutes, 1),
    elapsed_unit: 'minutes',
    basis: quietMinutes === null ? 'unavailable' : 'workspace_activity',
    last_activity_at: lastActivityAt ? lastActivityAt.toISOString() : null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    scanned_at: now.toISOString(),
  }

  const statePath = join(workspace, ...STATE_DIR, 'time_sense.json')
  const previous = await readJson(statePath)
  const today = localDate(now)
  const baseline =
    previous?.baseline_date === today
      ? previous.baseline
      : { local_hour: hour, day_phase: dayPhase }

  const hourDelta = Math.min(
    Math.abs(hour - baseline.local_hour),
    24 - Math.abs(hour - baseline.local_hour),
  )
  const drift = previous ? clamp01(hourDelta / 12) : 0

  const state = {
    sense: 'time_sense',
    active: true,
    last_read: reading.scanned_at,
    reading,
    baseline,
    baseline_date: today,
    drift: round(drift, 2),
    notes: quietMinutes === null ? '没有读到 workspace_pulse 状态，elapsed 字段为 null。' : '',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
