// 工作区脉搏：只读文件树的元信息（名字、大小、修改时间），不读内容。
// v2：自己会走。每 2 分钟留一个采样点，最近 24 小时按 30 分钟一个格子存着；
// 第一次启动没有历史时，用文件 mtime 回填——这样"刚刚过去的 900 分钟"不是空白。
// 采样另存 pulse_samples.json，状态文件保持轻，别的感官只读状态。
import { readdir, stat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', '.cache', 'dist', 'build'])
const MAX_FILES = 4000
const MAX_WALK_MS = 2500
const RECENT_MS = 30 * 60 * 1000
const STATE_DIR = ['.dsh', 'sensory']
const SAMPLES_FILE = 'pulse_samples.json'
// 采样：一格 30 分钟，留 24 小时；两次采样至少隔 60 秒，免得抖动。
const SLOT_MS = 30 * 60 * 1000
const SLOT_COUNT = 48
const SAMPLE_WINDOW_MS = SLOT_MS * SLOT_COUNT
const MAX_SAMPLES = 720
const MIN_SAMPLE_GAP_MS = 60 * 1000

const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round = (n, digits = 2) => Number(n.toFixed(digits))
const toPosix = (p) => p.split('\\').join('/')

async function collectFiles(workspace) {
  const files = []
  const started = Date.now()

  async function walk(dir) {
    if (files.length >= MAX_FILES || Date.now() - started > MAX_WALK_MS) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES || Date.now() - started > MAX_WALK_MS) break
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(full)
      } else if (entry.isFile()) {
        try {
          const info = await stat(full)
          files.push({ path: full, size: info.size, mtimeMs: info.mtimeMs })
        } catch {
          // 读不到就跳过，不打断整次扫描
        }
      }
    }
  }

  await walk(workspace)
  return { files, truncated: files.length >= MAX_FILES }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 没有历史采样时，用文件 mtime 反推最近 24 小时的动静。
 * 一格 30 分钟，20 个文件改动算满格——和实时 activity_level 同一把尺子。
 */
function backfillSamples(files, now) {
  const buckets = new Map()
  for (const file of files) {
    const age = now - file.mtimeMs
    if (age < 0 || age > SAMPLE_WINDOW_MS) continue
    const index = Math.floor(age / SLOT_MS)
    buckets.set(index, (buckets.get(index) ?? 0) + 1)
  }

  const samples = []
  for (let index = SLOT_COUNT - 1; index >= 0; index -= 1) {
    const count = buckets.get(index) ?? 0
    samples.push({
      t: now - index * SLOT_MS,
      a: round(clamp01(count / 20)),
      q: round((index * SLOT_MS) / 60000, 1),
      backfill: true,
    })
  }
  return samples
}

function nextSamples(previousStorage, files, now, activityLevel) {
  const kept = Array.isArray(previousStorage?.samples)
    ? previousStorage.samples.filter(
        (sample) => Number.isFinite(sample?.t) && now - sample.t <= SAMPLE_WINDOW_MS,
      )
    : []

  const samples = kept.length > 0 ? kept : backfillSamples(files, now)
  const last = samples[samples.length - 1]
  if (!last || now - last.t >= MIN_SAMPLE_GAP_MS) {
    samples.push({ t: now, a: round(clamp01(activityLevel)), q: 0 })
  }

  return samples.slice(-MAX_SAMPLES)
}

/** 扫一次工作区，返回并落盘这个感官的状态。 */
export async function senseWorkspacePulse({ workspace, now = Date.now() } = {}) {
  if (!workspace) throw new Error('workspace_pulse 需要一个 workspace 路径')

  const { files, truncated } = await collectFiles(workspace)
  const recent = files
    .filter((file) => now - file.mtimeMs <= RECENT_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  const newest = files.reduce((max, file) => Math.max(max, file.mtimeMs), 0)
  const quietMinutes = newest > 0 ? Math.max(0, (now - newest) / 60000) : 0
  const activityLevel = clamp01(recent.length / 20)

  const statePath = join(workspace, ...STATE_DIR, 'workspace_pulse.json')
  const samplesPath = join(workspace, ...STATE_DIR, SAMPLES_FILE)
  const previous = await readJson(statePath)
  const previousSamples = await readJson(samplesPath)
  const samples = nextSamples(previousSamples, files, now, activityLevel)
  const spanMinutes = samples.length ? round((now - samples[0].t) / 60000, 1) : 0

  const reading = {
    recent_changes: recent.slice(0, 20).map((file) => ({
      path: toPosix(relative(workspace, file.path)),
      size: file.size,
      modified: new Date(file.mtimeMs).toISOString(),
    })),
    quiet_minutes: round(quietMinutes, 1),
    activity_level: round(activityLevel, 2),
    file_count: files.length,
    truncated,
    samples: samples.length,
    sample_span_minutes: spanMinutes,
    scanned_at: new Date(now).toISOString(),
  }

  // 基线用 EMA，避免一次扫描的抖动把 drift 拉满。
  const baseline = previous
    ? {
        activity_level: round(previous.baseline.activity_level * 0.8 + reading.activity_level * 0.2, 2),
        quiet_minutes: round(previous.baseline.quiet_minutes * 0.8 + reading.quiet_minutes * 0.2, 1),
      }
    : {
        activity_level: reading.activity_level,
        quiet_minutes: reading.quiet_minutes,
      }

  const drift = previous
    ? clamp01(
        Math.abs(reading.activity_level - baseline.activity_level) +
          Math.abs(reading.quiet_minutes - baseline.quiet_minutes) / 120,
      )
    : 0

  const state = {
    sense: 'workspace_pulse',
    active: true,
    last_read: reading.scanned_at,
    last_tick: reading.scanned_at,
    reading,
    baseline,
    drift: round(drift, 2),
    notes: truncated ? `扫描达到 ${MAX_FILES} 个文件上限，读数只覆盖前一部分。` : '',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(samplesPath, `${JSON.stringify({ samples }, null, 0)}\n`, 'utf8')
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
