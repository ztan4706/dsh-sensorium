// Workspace pulse: reads file-tree metadata only (name, size, mtime), never contents.
// v2: runs on its own. It keeps one sample every 2 minutes, stored in 30-minute slots for the last 24 hours;
// on first start with no history it backfills from file mtimes, so the last 900 minutes are not blank.
// Samples live in pulse_samples.json so the state file stays light; other senses read only the state.
import { readdir, stat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.dsh', '.cache', 'dist', 'build'])
const MAX_FILES = 4000
const MAX_WALK_MS = 2500
const RECENT_MS = 30 * 60 * 1000
const STATE_DIR = ['.dsh', 'sensory']
const SAMPLES_FILE = 'pulse_samples.json'
// Sampling: 30-minute slots kept for 24 hours; samples at least 60 seconds apart to avoid jitter.
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
          // Unreadable entries are skipped; never abort the scan.
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
 * With no sample history, infer the last 24 hours of activity from file mtimes.
 * One slot is 30 minutes; 20 changed files fill a slot - the same scale as live activity_level.
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

/** Scan the workspace once; return and persist this sense's state. */
export async function senseWorkspacePulse({ workspace, now = Date.now() } = {}) {
  if (!workspace) throw new Error('workspace_pulse requires a workspace path')

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

  // Baseline uses an EMA so one jittery scan does not max out drift.
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
    notes: truncated ? `Scan hit the ${MAX_FILES}-file limit; the reading covers only the first part.` : '',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(samplesPath, `${JSON.stringify({ samples }, null, 0)}\n`, 'utf8')
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
