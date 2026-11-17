import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DataStore } from './data-store.js'
import { getExplicitCFEContactEmailFromConfig, readEmailRecipientConfig, writeEmailRecipientConfig } from './email-service.js'
import { readTrainingVideoCatalog } from './training-videos.js'

const withTempEnv = async <T>(key: string, value: string | undefined, callback: () => Promise<T>): Promise<T> => {
  const originalValue = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value

  try {
    return await callback()
  } finally {
    if (originalValue === undefined) delete process.env[key]
    else process.env[key] = originalValue
  }
}

test('public history attendance estimates persist without overwriting actual attendance', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-estimate-'))
  const filePath = path.join(directory, 'scheduler.yaml')
  await writeFile(filePath, JSON.stringify({
    window: { start: '2020-01-01', end: '2020-01-31', durationMinutes: 60 },
    trainings: [{ id: 'bt-log', title: 'BT Debug Training', shortTitle: 'BT Debug', instructor: 'Test', accent: 'blue', mode: 'Live' }],
    sessions: [
      { id: 's1', trainingId: 'bt-log', date: '2020-01-01', startTime: '10:00', durationMinutes: 60, status: 'active' },
      { id: 's2', trainingId: 'bt-log', date: '2020-01-01', startTime: '11:00', durationMinutes: 60, status: 'active' },
    ],
    bookings: [
      { id: 'b1', sessionId: 's1', oem: 'Dell', requesterName: 'Test', requesterEmail: 'test@example.com', createdAt: '2020-01-01T00:00:00Z', status: 'confirmed' },
      { id: 'b2', sessionId: 's2', oem: 'Dell', requesterName: 'Test', requesterEmail: 'test@example.com', createdAt: '2020-01-01T00:00:00Z', status: 'cancelled' },
    ],
    attendance: [], version: 0,
  }), 'utf8')
  const socket = createServer()
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve))
  const address = socket.address()
  if (!address || typeof address === 'string') throw new Error('PORT_UNAVAILABLE')
  const port = address.port
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()))
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), DATA_FILE: filePath, SCHEDULER_PASSWORD: 'test-password', EMAIL_RECIPIENTS_FILE: path.join(directory, 'recipients.yaml'), TLS_KEY_FILE: '', TLS_CERT_FILE: '', HTTP_REDIRECT_PORT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SERVER_START_TIMEOUT')), 10000)
      server.once('error', (error) => { clearTimeout(timer); reject(error) })
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`SERVER_EXITED_${code}`)) })
      server.stdout.once('data', () => { clearTimeout(timer); resolve() })
    })
    const baseUrl = `http://127.0.0.1:${port}`
    const save = (sessionId: string, attendeeCount: unknown) => fetch(`${baseUrl}/api/sessions/${sessionId}/attendance-estimate`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendeeCount }),
    })
    assert.equal((await fetch(`${baseUrl}/api/email-recipients`)).status, 401)
    assert.equal((await save('s1', null)).status, 400)
    assert.equal((await save('s1', 1001)).status, 400)
    assert.equal((await save('s2', 3)).status, 400)
    assert.equal((await save('missing', 3)).status, 404)
    assert.equal((await save('s1', 0)).status, 200)
    assert.equal((await save('s1', 7)).status, 200)
    const stored = await new DataStore(filePath).read()
    assert.equal(stored.sessions.find((session) => session.id === 's1')?.estimatedAttendeeCount, 7)
    const historyResponse = await fetch(`${baseUrl}/api/history`)
    assert.equal(historyResponse.status, 200)
    const history = await historyResponse.json() as { sessions: { sessionId: string; attendeeCount: number; attendanceEstimated?: boolean }[] }
    assert.equal(history.sessions.find((session) => session.sessionId === 's1')?.attendeeCount, 7)
    assert.equal(history.sessions.find((session) => session.sessionId === 's1')?.attendanceEstimated, true)
    await new DataStore(filePath).update((data) => {
      data.attendance?.push({ id: 'a1', sessionId: 's1', trainingId: 'bt-log', attendeeCount: 9, instructorEmail: 'instructor@example.com', recordedAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' })
    })
    assert.equal((await save('s1', 8)).status, 409)
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()))
      server.kill()
      await exited
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('reads a custom email recipient config from disk', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-recipients-'))
  const configPath = path.join(directory, 'email-recipients.yaml')
  const yamlText = `wifi-8:
  default: default@example.com
  Lenovo Ideapad: lenovo@example.com
`
  await writeFile(configPath, yamlText, 'utf8')

  await withTempEnv('EMAIL_RECIPIENTS_FILE', configPath, async () => {
    const config = await readEmailRecipientConfig()
    assert.equal(config['wifi-8'].default, 'default@example.com')
    assert.equal(config['wifi-8']['Lenovo Ideapad'], 'lenovo@example.com')
  })

  await rm(directory, { recursive: true, force: true })
})

test('writes and normalizes recipient configuration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-config-'))
  const configPath = path.join(directory, 'email-recipients.yaml')
  const yamlText = `wifi-8:
  default: default@example.com
  Lenovo Ideapad: lenovo@example.com
`

  await withTempEnv('EMAIL_RECIPIENTS_FILE', configPath, async () => {
    const config = await writeEmailRecipientConfig(yamlText)
    assert.equal(config['wifi-8']['Lenovo Ideapad'], 'lenovo@example.com')
    const written = await readFile(configPath, 'utf8')
    assert.match(written, /Lenovo Ideapad: lenovo@example.com/)
  })

  await rm(directory, { recursive: true, force: true })
})

test('prefers exact OEM/ODM routing while only falling back to default when appropriate', () => {
  const config = {
    'wifi-8': {
      default: 'default@example.com',
      'Lenovo Ideapad': 'lenovo@example.com',
    },
    'bt-hdt': {
      default: 'bt-default@example.com',
      HP: 'hp@example.com',
    },
  } as const

  assert.equal(getExplicitCFEContactEmailFromConfig('wifi-8', 'Lenovo Ideapad', 'NA', config), 'lenovo@example.com')
  assert.equal(getExplicitCFEContactEmailFromConfig('wifi-8', 'Acer', undefined, config), null)
  assert.equal(getExplicitCFEContactEmailFromConfig('wifi-8', undefined, undefined, config), null)
  assert.equal(getExplicitCFEContactEmailFromConfig('bt-hdt', 'HP', 'NA', config), 'hp@example.com')
  assert.equal(getExplicitCFEContactEmailFromConfig('bt-hdt', 'Dell', undefined, config), null)
})

test('loads a valid training video catalog from disk', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-videos-'))
  const videosPath = path.join(directory, 'training-videos.yaml')
  const yamlText = `libraryUrl: https://example.com/library
videos:
  - subject: Sample Topic
    english:
      title: English
      url: https://example.com/video-en
    mandarin:
      title: Mandarin
      url: https://example.com/video-zh
`
  await writeFile(videosPath, yamlText, 'utf8')

  await withTempEnv('TRAINING_VIDEOS_FILE', videosPath, async () => {
    const catalog = await readTrainingVideoCatalog()
    assert.equal(catalog.libraryUrl, 'https://example.com/library')
    assert.equal(catalog.videos[0].subject, 'Sample Topic')
    assert.equal(catalog.videos[0].english?.url, 'https://example.com/video-en')
    assert.equal(catalog.videos[0].mandarin?.title, 'Mandarin')
  })

  await rm(directory, { recursive: true, force: true })
})

test('rejects malformed training video catalog YAML', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'training-scheduler-invalid-videos-'))
  const videosPath = path.join(directory, 'training-videos.yaml')
  await writeFile(videosPath, 'videos:\n  - subject: Sample\n    english: [broken', 'utf8')

  await withTempEnv('TRAINING_VIDEOS_FILE', videosPath, async () => {
    await assert.rejects(() => readTrainingVideoCatalog(), /INVALID_TRAINING_VIDEOS_YAML/)
  })

  await rm(directory, { recursive: true, force: true })
})
