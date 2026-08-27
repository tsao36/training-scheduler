import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import { dump } from 'js-yaml'
import { createDataStore, type Booking } from './data-store.js'
import { readEmailRecipientConfig, sendBookingNotificationEmail, getCFEContactEmail, writeEmailRecipientConfig } from './email-service.js'

const password = process.env.SCHEDULER_PASSWORD
if (!password) throw new Error('SCHEDULER_PASSWORD is required')
const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173'
const store = createDataStore()
const app = express()
const port = Number(process.env.PORT ?? 3001)
const staticRoot = path.resolve('dist')
const OEM_OPTIONS = new Set(['Dell', 'HP', 'Asus', 'Acer', 'Fujitsu', 'VAIO', 'Panasonic', 'NEC', 'Samsung', 'LG', 'Honor', 'Wiko', 'Dynabook', 'Google', 'Microsoft', 'MSFT Surface', 'MSI', 'Xiaomi', 'Lenovo China', 'Lenovo Japan', 'NA'])
const ODM_OPTIONS = new Set(['Quanta', 'Pegatron', 'Wistron', 'Inventec', 'Compal', 'LCFC', 'Luxshare', 'Huaqin', 'Longcheer', 'NA'])
const isDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const trainingUnavailableLabel = (trainingId: string, title: string) => {
  if (trainingId === 'wifi-log') return 'WiFi Debug Training'
  if (trainingId === 'bt-log') return 'BT Debug Training'
  return title.replace(/\s+for\s+/i, ' ')
}
const hasUnavailableDayBlock = (data: Awaited<ReturnType<typeof store.read>>, sessionId: string) => {
  const session = data.sessions.find((item) => item.id === sessionId)
  if (!session) return false
  const training = data.trainings.find((item) => item.id === session.trainingId)
  if (!training) return false
  const label = trainingUnavailableLabel(training.id, training.title)
  return (data.unavailableDays ?? []).some((item) => item.date === session.date && item.label === label)
}

app.use(express.json())
app.use(cookieParser(password))

const isScheduler = (request: Request) => request.signedCookies.scheduler === 'true'
const requireScheduler = (request: Request, response: Response, next: NextFunction) => {
  if (!isScheduler(request)) return response.status(401).json({ error: 'SCHEDULER_AUTH_REQUIRED' })
  next()
}

const sendData = async (_request: Request, response: Response) => {
  const data = await store.read()
  const trainings = new Map(data.trainings.map((training) => [training.id, training]))
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json({ ...data, sessions: data.sessions.map((session) => ({ ...session, training: trainings.get(session.trainingId) })), bookings: data.bookings.filter((booking) => booking.status === 'confirmed') })
}

app.get('/api/scheduler', sendData)
app.get('/api/bookings', async (request, response) => {
  const email = String(request.query.email ?? '').trim().toLowerCase()
  if (!email) return response.status(400).json({ error: 'REQUESTER_EMAIL_REQUIRED' })
  const data = await store.read()
  const trainings = new Map(data.trainings.map((training) => [training.id, training]))
  const sessions = new Map(data.sessions.map((session) => [session.id, session]))
  const matches = data.bookings
    .filter((booking) => (booking.status === 'confirmed' || booking.status === 'pending') && booking.requesterEmail.toLowerCase() === email)
    .map((booking) => ({ ...booking, session: sessions.get(booking.sessionId), training: sessions.get(booking.sessionId) ? trainings.get(sessions.get(booking.sessionId)!.trainingId) : undefined }))
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json({ bookings: matches })
})
app.post('/api/auth/login', (request, response) => {
  if (request.body?.password !== password) return response.status(401).json({ error: 'INVALID_PASSWORD' })
  response.cookie('scheduler', 'true', { signed: true, httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' })
  response.json({ authenticated: true })
})
app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie('scheduler')
  response.status(204).end()
})
app.get('/api/auth/status', (request, response) => response.json({ authenticated: isScheduler(request) }))

app.get('/api/email-recipients', requireScheduler, async (_request, response) => {
  const recipients = await readEmailRecipientConfig()
  response.json({ yaml: dump(recipients, { noRefs: true }) })
})

app.put('/api/email-recipients', requireScheduler, async (request, response) => {
  const yamlText = typeof request.body?.yaml === 'string' ? request.body.yaml : ''
  if (!yamlText.trim()) return response.status(400).json({ error: 'EMAIL_RECIPIENTS_REQUIRED' })
  const recipients = await writeEmailRecipientConfig(yamlText)
  response.json({ updated: true, recipients })
})

app.post('/api/sessions', requireScheduler, async (request, response) => {
  const { trainingId, date, startTime } = request.body ?? {}
  const data = await store.update((current) => {
    const training = current.trainings.find((item) => item.id === trainingId)
    if (!training) throw new Error('TRAINING_NOT_FOUND')
    const startMinutes = Number(startTime?.slice(0, 2)) * 60 + Number(startTime?.slice(3, 5))
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    if (!/^2026-(09-(1[4-9]|2[0-9])|10-0[12])$/.test(date) || weekday === 0 || weekday === 6 || !/^\d{2}:(00|30)$/.test(startTime) || startMinutes < 540 || startMinutes > 1020) throw new Error('INVALID_SESSION_TIME')
    if (current.sessions.some((session) => session.status === 'active' && session.trainingId === trainingId && session.date === date && session.startTime === startTime)) throw new Error('DUPLICATE_SESSION')
    if (current.sessions.some((session) => session.status === 'active' && session.date === date && session.startTime === startTime && current.trainings.find((item) => item.id === session.trainingId)?.instructor === training.instructor)) throw new Error('INSTRUCTOR_CONFLICT')
    current.sessions.push({ id: crypto.randomUUID(), trainingId, date, startTime, durationMinutes: current.window.durationMinutes, status: 'active' })
  })
  response.status(201).json(data)
})

app.delete('/api/sessions/:id', requireScheduler, async (request, response) => {
  await store.update((data) => {
    const session = data.sessions.find((item) => item.id === request.params.id)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    const hasBookings = data.bookings.some((booking) => booking.sessionId === session.id)
    if (hasBookings) session.status = 'cancelled'
    else data.sessions = data.sessions.filter((item) => item.id !== session.id)
  })
  response.status(204).end()
})

app.post('/api/bookings', async (request, response) => {
  const { sessionId, oem, odm, requesterName, requesterEmail } = request.body ?? {}
  if (!sessionId || !oem || !odm || !requesterName || !requesterEmail) return response.status(400).json({ error: 'REQUIRED_FIELDS_MISSING' })
  const selectedOem = String(oem)
  const selectedOdm = String(odm)
  if (!OEM_OPTIONS.has(selectedOem) || !ODM_OPTIONS.has(selectedOdm)) return response.status(400).json({ error: 'INVALID_CUSTOMER_SELECTION' })
  let booking: Booking | undefined
  let session: Awaited<ReturnType<typeof store.read>>['sessions'][0] | undefined
  let training: Awaited<ReturnType<typeof store.read>>['trainings'][0] | undefined
  
  await store.update((data) => {
    session = data.sessions.find((item) => item.id === sessionId && item.status === 'active')
    if (!session) throw new Error('SESSION_NOT_FOUND')

    if (hasUnavailableDayBlock(data, session.id)) throw new Error('BOOKING_BLOCKED')

    const hasDuplicateTopicCustomerBooking = data.bookings.some((existing) => {
      if (existing.status !== 'confirmed') return false
      if (existing.oem !== selectedOem) return false
      if ((existing.odm ?? 'NA') !== selectedOdm) return false
      const existingSession = data.sessions.find((item) => item.id === existing.sessionId)
      return existingSession?.trainingId === session!.trainingId
    })
    if (hasDuplicateTopicCustomerBooking) throw new Error('DUPLICATE_TOPIC_CUSTOMER_BOOKING')

    training = data.trainings.find((item) => item.id === session!.trainingId)
    booking = {
      id: randomUUID(),
      sessionId,
      oem: selectedOem,
      odm: selectedOdm,
      requesterName,
      requesterEmail: requesterEmail.toLowerCase(),
      createdAt: new Date().toISOString(),
      status: 'confirmed',
    }
    data.bookings.push(booking)
  })

  let instructorEmail: string | null = null
  try {
    if (booking && session && training) {
      instructorEmail = await getCFEContactEmail(training.id, selectedOem, selectedOdm)
      await sendBookingNotificationEmail(
        booking.requesterEmail,
        booking.requesterName,
        training.title,
        session.date,
        session.startTime,
        instructorEmail ?? undefined,
      )
    }
  } catch (error) {
    console.error('Failed to send booking notification email:', error)
  }

  response.status(201).json({ ...booking, instructorEmail })
})

app.post('/api/unavailable-days', requireScheduler, async (request, response) => {
  const { trainingId, startDate, endDate, warning } = request.body ?? {}
  if (!trainingId || !isDate(startDate) || !isDate(endDate)) return response.status(400).json({ error: 'REQUIRED_UNAVAILABLE_FIELDS_MISSING' })
  if (startDate > endDate) return response.status(400).json({ error: 'INVALID_UNAVAILABLE_RANGE' })

  await store.update((data) => {
    if (!data.trainings.some((training) => training.id === trainingId)) throw new Error('TRAINING_NOT_FOUND')
    const training = data.trainings.find((item) => item.id === trainingId)!
    const label = trainingUnavailableLabel(training.id, training.title)
    const message = typeof warning === 'string' && warning.trim() ? warning.trim() : `${label} is not available all day.`
    const existing = new Set((data.unavailableDays ?? []).map((item) => `${item.date}|${item.label}`))
    const dates: string[] = []
    for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= new Date(`${endDate}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      dates.push(cursor.toISOString().slice(0, 10))
    }
    data.unavailableDays ??= []
    dates.forEach((date) => {
      const key = `${date}|${label}`
      if (existing.has(key)) return
      data.unavailableDays!.push({ date, label, warning: message })
      existing.add(key)
    })
  })
  response.status(201).json({ created: true })
})

app.delete('/api/unavailable-days', requireScheduler, async (request, response) => {
  const { date, label } = request.body ?? {}
  if (!isDate(date) || typeof label !== 'string' || !label.trim()) return response.status(400).json({ error: 'REQUIRED_UNAVAILABLE_FIELDS_MISSING' })
  await store.update((data) => {
    const before = (data.unavailableDays ?? []).length
    data.unavailableDays = (data.unavailableDays ?? []).filter((item) => !(item.date === date && item.label === label))
    if (data.unavailableDays.length === before) throw new Error('UNAVAILABLE_DAY_NOT_FOUND')
  })
  response.status(204).end()
})

app.delete('/api/bookings/:id', async (request, response) => {
  const email = String(request.body?.requesterEmail ?? '')
  await store.update((data) => {
    const booking = data.bookings.find((item) => item.id === request.params.id && item.requesterEmail === email && item.status === 'confirmed')
    if (!booking) throw new Error('BOOKING_NOT_FOUND')
    booking.status = 'cancelled'
    booking.cancelledAt = new Date().toISOString()
  })
  response.status(204).end()
})

app.use(express.static(staticRoot))
app.use((_request, response) => response.sendFile(path.join(staticRoot, 'index.html')))
app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
  const status = error.message.endsWith('_NOT_FOUND') ? 404 : error.message.includes('CONFLICT') || error.message.includes('DUPLICATE') ? 409 : 400
  response.status(status).json({ error: error.message })
})

await store.validate()
const backupTimes = new Set(['11:00', '20:00'])
let lastBackupKey = ''
const runScheduledBackup = async () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const minute = `${values.hour}:${values.minute}`
  const backupKey = `${values.year}-${values.month}-${values.day}-${minute}`
  if (!backupTimes.has(minute) || backupKey === lastBackupKey) return
  lastBackupKey = backupKey
  try {
    const backupPath = await store.backup()
    console.log(`Scheduler backup created: ${backupPath}`)
  } catch (error) {
    console.error('Scheduler backup failed:', error)
  }
}
const backupInterval = setInterval(() => { void runScheduledBackup() }, 30_000)
backupInterval.unref()
app.listen(port, () => console.log(`Training Scheduler listening on port ${port}`))
