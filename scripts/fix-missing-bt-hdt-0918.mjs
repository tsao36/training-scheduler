// One-off, idempotent fix for a specific data gap: the live scheduler.yaml was missing all
// bt-hdt (BT HDT) sessions for 2026-09-18 (09:00-17:00, 30-min increments), so that date never
// showed BT HDT as a bookable topic. Safe to run against the LIVE production data file — it only
// adds sessions if they don't already exist, and never touches bookings or any other training.
//
// Usage (run ON THE SERVER, pointed at the live DATA_FILE, e.g.):
//   node scripts/fix-missing-bt-hdt-0918.mjs "C:\path\to\live\scheduler.yaml"
//   (or set DATA_FILE env var and omit the argument)

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { dump, load } from 'js-yaml'

const dataFile = process.argv[2] ?? process.env.DATA_FILE
if (!dataFile) {
  console.error('Usage: node scripts/fix-missing-bt-hdt-0918.mjs <path-to-live-scheduler.yaml>')
  process.exit(1)
}

const TRAINING_ID = 'bt-hdt'
const DATE = '2026-09-18'
const TIMES = []
for (let minutes = 9 * 60; minutes <= 17 * 60; minutes += 30) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0')
  const minute = String(minutes % 60).padStart(2, '0')
  TIMES.push(`${hour}:${minute}`)
}

const raw = await fs.readFile(dataFile, 'utf8')
const data = load(raw)
if (!data || typeof data !== 'object') throw new Error('Could not parse scheduler data file')

const durationMinutes = data.window?.durationMinutes ?? 30
const existing = new Set(
  data.sessions.filter((s) => s.trainingId === TRAINING_ID && s.date === DATE).map((s) => s.startTime),
)

const added = []
for (const startTime of TIMES) {
  if (existing.has(startTime)) continue
  data.sessions.push({ id: randomUUID(), trainingId: TRAINING_ID, date: DATE, startTime, durationMinutes, status: 'active' })
  added.push(startTime)
}

if (added.length === 0) {
  console.log(`No missing ${TRAINING_ID} sessions for ${DATE}. Nothing to do.`)
  process.exit(0)
}

data.version = (data.version ?? 0) + 1
await fs.writeFile(dataFile, dump(data, { noRefs: true }), 'utf8')
console.log(`Added ${added.length} missing ${TRAINING_ID} session(s) for ${DATE}: ${added.join(', ')}`)
