// Idempotent extension of the schedule window from 2026-10-09 to 2026-10-30. The calendar UI now
// shows the weeks of 10/12, 10/19 and 10/26, but the booking menu only offers dates that have
// sessions, so this script mirrors the last fully populated weekday (2026-10-09) onto every new
// weekday. Bookings after 2026-10-09 are restricted to Dell by the API.
//
// Safe to run against the LIVE data file — it only adds sessions that don't already exist and
// never touches bookings.
//
// Usage:
//   node scripts/extend-sessions-to-1030.mjs "C:\path\to\live\scheduler.yaml"
//   (or set DATA_FILE env var and omit the argument)

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { dump, load } from 'js-yaml'

const dataFile = process.argv[2] ?? process.env.DATA_FILE
if (!dataFile) {
  console.error('Usage: node scripts/extend-sessions-to-1030.mjs <path-to-scheduler.yaml>')
  process.exit(1)
}

const TEMPLATE_DATE = '2026-10-09'
const NEW_DATES = [
  '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
  '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
  '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
]

const raw = await fs.readFile(dataFile, 'utf8')
const data = load(raw)
if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)) throw new Error('Could not parse scheduler data file')

const template = data.sessions.filter((session) => session.date === TEMPLATE_DATE && session.status === 'active')
if (template.length === 0) throw new Error(`No active sessions found for template date ${TEMPLATE_DATE}`)

const existing = new Set(data.sessions.map((session) => `${session.date}|${session.trainingId}|${session.startTime}`))

let added = 0
for (const date of NEW_DATES) {
  for (const session of template) {
    const key = `${date}|${session.trainingId}|${session.startTime}`
    if (existing.has(key)) continue
    data.sessions.push({
      id: randomUUID(),
      trainingId: session.trainingId,
      date,
      startTime: session.startTime,
      durationMinutes: session.durationMinutes,
      status: 'active',
    })
    existing.add(key)
    added += 1
  }
}

data.window ??= {}
data.window.end = '2026-10-30'

if (added === 0) {
  console.log('Schedule already extended through 2026-10-30. Nothing to do.')
  process.exit(0)
}

data.version = (data.version ?? 0) + 1
await fs.writeFile(dataFile, dump(data, { noRefs: true }), 'utf8')
console.log(`Added ${added} session(s) across ${NEW_DATES.length} new weekday(s) through 2026-10-30.`)
