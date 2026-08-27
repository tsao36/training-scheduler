import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DataStore } from './data-store.js'

const validYaml = `window:
  start: '2026-09-14'
  end: '2026-10-02'
  durationMinutes: 30
trainings: []
sessions: []
bookings: []
version: 0
`

test('serializes concurrent updates without losing either change', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-'))
  const filePath = path.join(directory, 'scheduler.yaml')
  await writeFile(filePath, validYaml, 'utf8')
  const store = new DataStore(filePath)

  await Promise.all([
    store.update((data) => data.sessions.push({ id: 'session-a', trainingId: 'wifi-8', date: '2026-09-14', startTime: '09:00', durationMinutes: 30, status: 'active' })),
    store.update((data) => data.sessions.push({ id: 'session-b', trainingId: 'wifi-log', date: '2026-09-14', startTime: '09:30', durationMinutes: 30, status: 'active' })),
  ])

  const result = await store.read()
  assert.equal(result.version, 2)
  assert.deepEqual(result.sessions.map((session) => session.id).sort(), ['session-a', 'session-b'])
  await rm(directory, { recursive: true, force: true })
})

test('rejects malformed scheduler YAML', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-'))
  const filePath = path.join(directory, 'scheduler.yaml')
  await writeFile(filePath, 'window:\n  start: [broken\n', 'utf8')
  const store = new DataStore(filePath)

  await assert.rejects(() => store.validate())
  await rm(directory, { recursive: true, force: true })
})

test('writes a valid YAML document after an update', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-'))
  const filePath = path.join(directory, 'scheduler.yaml')
  await writeFile(filePath, validYaml, 'utf8')
  const store = new DataStore(filePath)

  await store.update((data) => data.bookings.push({ id: 'booking-a', sessionId: 'session-a', oem: 'Customer', requesterName: 'Test User', requesterEmail: 'test@example.com', createdAt: new Date().toISOString(), status: 'confirmed' }))
  const written = await readFile(filePath, 'utf8')
  assert.match(written, /booking-a/)
  assert.equal((await store.read()).bookings.length, 1)
  await rm(directory, { recursive: true, force: true })
})

test('creates a YAML backup and keeps only the latest eight backups', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-'))
  const filePath = path.join(directory, 'scheduler.yaml')
  const backupDirectory = path.join(directory, 'backups')
  await writeFile(filePath, validYaml, 'utf8')
  const store = new DataStore(filePath, backupDirectory)

  for (let index = 0; index < 10; index += 1) await store.backup()

  const backups = (await readdir(backupDirectory)).filter((name) => name.endsWith('.yaml'))
  assert.equal(backups.length, 8)
  await rm(directory, { recursive: true, force: true })
})

test('maps wifi and bt bookings to engineering notification recipients', async () => {
  const { getBookingNotificationRecipients, getCFEContactEmail } = await import('./email-service.js')

  assert.equal(await getCFEContactEmail('wifi-log'), 'hannahx.hung@intel.com')
  assert.equal(await getCFEContactEmail('bt-log'), 'shih-hsinx.shen@intel.com')
  assert.equal(await getCFEContactEmail('wifi-8', 'Dell'), 'frank.fc.yang@intel.com')
  assert.equal(await getCFEContactEmail('wifi-8', 'Honor'), 'charles.p.chu@intel.com')
  assert.equal(await getCFEContactEmail('bt-hdt', 'HP'), 'steven1.chen@intel.com')
  assert.equal(await getCFEContactEmail('bt-hdt', 'Asus'), 'yu-wei.chen@intel.com')

  assert.deepEqual(await getBookingNotificationRecipients('wifi-log', 'requester@example.com'), [
    'requester@example.com',
    'hannahx.hung@intel.com',
  ])
  assert.deepEqual(await getBookingNotificationRecipients('wifi-8', 'requester@example.com', 'Lenovo China'), [
    'requester@example.com',
    'nicky.chen@intel.com',
  ])
  assert.deepEqual(await getBookingNotificationRecipients('bt-hdt', 'requester@example.com', 'MSFT Surface'), [
    'requester@example.com',
    'steven1.chen@intel.com',
  ])
})
