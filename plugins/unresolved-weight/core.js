// Unresolved items: explicitly marked; weight grows with age and never decays.
// One tool: a read may also add or resolve; it writes only its own state file.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STATE_DIR = ['.dsh', 'sensory']
const DAY_MS = 24 * 60 * 60 * 1000
const clamp01 = (n) => Math.max(0, Math.min(1, n))
const round = (n, digits = 2) => Number(n.toFixed(digits))

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

/** Read unresolved weight; optionally add or resolve. */
export async function senseUnresolvedWeight({
  workspace,
  now = new Date(),
  add,
  resolve,
  note,
} = {}) {
  if (!workspace) throw new Error('unresolved_weight requires a workspace path')
  const nowDate = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(nowDate.getTime())) throw new Error('unresolved_weight received an invalid time')

  const statePath = join(workspace, ...STATE_DIR, 'unresolved_weight.json')
  const previous = await readJson(statePath)
  const items = Array.isArray(previous?.items) ? previous.items : []

  if (typeof add === 'string' && add.trim() !== '') {
    items.push({
      id: `u-${nowDate.getTime()}-${randomUUID().slice(0, 6)}`,
      title: add.trim(),
      note: typeof note === 'string' ? note.trim() : '',
      created_at: nowDate.toISOString(),
      resolved_at: null,
    })
  }

  if (typeof resolve === 'string' && resolve.trim() !== '') {
    const key = resolve.trim()
    const target = items.find((item) => item.id === key || item.title === key)
    if (target !== undefined && target.resolved_at === null) {
      target.resolved_at = nowDate.toISOString()
    }
  }

  const open = items.filter((item) => item.resolved_at === null)
  const unresolvedItems = open
    .map((item) => {
      const ageDays = Math.max(0, (nowDate.getTime() - new Date(item.created_at).getTime()) / DAY_MS)
      // Even a new item has weight; it grows a little every day and never decays.
      const weight = clamp01(0.15 + 0.12 * ageDays)
      return {
        id: item.id,
        title: item.title,
        note: item.note,
        created_at: item.created_at,
        age_days: round(ageDays),
        weight: round(weight),
      }
    })
    .sort((a, b) => b.weight - a.weight)

  const totalWeight = unresolvedItems.reduce((sum, item) => sum + item.weight, 0)
  const oldestAgeDays = unresolvedItems.length
    ? Math.max(...unresolvedItems.map((item) => item.age_days))
    : 0

  const reading = {
    unresolved_items: unresolvedItems,
    count: unresolvedItems.length,
    total_weight: round(totalWeight),
    oldest_age_days: round(oldestAgeDays),
    resolved_count: items.filter((item) => item.resolved_at !== null).length,
    scanned_at: nowDate.toISOString(),
  }

  const state = {
    sense: 'unresolved_weight',
    active: true,
    last_read: reading.scanned_at,
    reading,
    baseline: { total_weight: 0 },
    drift: round(clamp01(totalWeight / 3)),
    items,
    notes: unresolvedItems.length === 0 ? 'Nothing is pending.' : '',
  }

  await mkdir(join(workspace, ...STATE_DIR), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  return state
}
