import cookieParser from 'cookie-parser'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import express, { type NextFunction, type Request, type Response } from 'express'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { dump } from 'js-yaml'
import { createDataStore, type AttendanceRecord, type Booking } from './data-store.js'
import { readEmailRecipientConfig, sendBookingNotificationEmail, sendBookingCancellationNotificationEmail, sendInstructorUpdateNotificationEmail, getCFEContactEmail, getCFEContactEmailFromConfig, getExplicitCFEContactEmail, writeEmailRecipientConfig } from './email-service.js'
import { resolveDisplayTrainingId } from './booking-topic.js'
import { readTrainingVideoCatalog } from './training-videos.js'

const password = process.env.SCHEDULER_PASSWORD
if (!password) throw new Error('SCHEDULER_PASSWORD is required')
const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173'
const serverVersion = process.env.APP_VERSION ?? (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
})()
const store = createDataStore()
const app = express()
const port = Number(process.env.PORT ?? 3001)
const tlsKeyFile = process.env.TLS_KEY_FILE
const tlsCertFile = process.env.TLS_CERT_FILE
const tlsEnabled = Boolean(tlsKeyFile && tlsCertFile)
// Optional plain-HTTP listener that only redirects to HTTPS.
const httpRedirectPort = process.env.HTTP_REDIRECT_PORT ? Number(process.env.HTTP_REDIRECT_PORT) : undefined
const staticRoot = path.resolve('dist')
const OEM_OPTIONS = new Set(['Dell', 'HP', 'Asus', 'Acer', 'Fujitsu', 'VAIO', 'Panasonic', 'NEC', 'Samsung', 'LG', 'Honor', 'Wiko', 'Dynabook', 'Google', 'Microsoft', 'MSFT Surface', 'MSI', 'GIGABYTE', 'Xiaomi', 'Aistone', 'PRC CTE', 'Lenovo Ideapad', 'Lenovo ThinkPad', 'NA'])
const ODM_OPTIONS = new Set(['Quanta', 'Pegatron', 'Wistron', 'Inventec', 'Compal', 'LCFC', 'Luxshare', 'Huaqin', 'Longcheer', 'NA'])
const TRAINING_FORMAT_OPTIONS = new Set(['with-video', 'without-video'])
const DELL_ONLY_OEM = 'Dell'
// Trainings that are only offered to Dell and always route to a fixed instructor.
const DELL_ONLY_INSTRUCTOR_EMAILS: Record<string, string> = {
  'bios-sar': 'frank.fc.yang@intel.com',
}
const DELL_ONLY_TRAINING_IDS = new Set(['bios-sar', 'killer'])
const TEST_INSTRUCTOR_EMAIL = 'tsao36@gmail.com'
const dellOnlyInstructorEmail = (trainingId?: string) => (trainingId ? DELL_ONLY_INSTRUCTOR_EMAILS[trainingId] : undefined)
// Sessions after this date are reserved for Dell only.
const DELL_ONLY_PERIOD_AFTER = '2026-10-09'
const instructorForTraining = async (trainingId: string, oem: string, odm: string) =>
  dellOnlyInstructorEmail(trainingId) ?? getCFEContactEmail(trainingId, oem, odm)
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
const isSystemUnavailableBooking = (booking: Booking) =>
  booking.requesterEmail === 'scheduler-block@local' ||
  booking.requesterName === 'System Block' ||
  booking.oem === 'Not available'
const isEmail = (value: unknown) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const sendData = async (_request: Request, response: Response) => {
  const data = await store.read()
  const trainings = new Map(data.trainings.map((training) => [training.id, training]))
  const sessions = new Map(data.sessions.map((session) => [session.id, session]))
  const recipientConfig = await readEmailRecipientConfig()
  const resolveInstructor = (booking: Booking) => {
    if (booking.instructorEmail) return booking.instructorEmail
    const trainingId = booking.trainingId ?? sessions.get(booking.sessionId)?.trainingId
    const fixedInstructor = dellOnlyInstructorEmail(trainingId)
    if (fixedInstructor) return fixedInstructor
    return trainingId ? getCFEContactEmailFromConfig(trainingId, booking.oem, booking.odm ?? 'NA', recipientConfig) ?? undefined : undefined
  }
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json({
    ...data,
    sessions: data.sessions.map((session) => {
      const effectiveTrainingId = resolveDisplayTrainingId(
        session.trainingId,
        data.bookings.filter((booking) => booking.sessionId === session.id),
        session.id,
      )
      return { ...session, training: trainings.get(effectiveTrainingId ?? session.trainingId) }
    }),
    bookings: data.bookings.filter((booking) => booking.status === 'confirmed').map((booking) => ({ ...booking, instructorEmail: resolveInstructor(booking) })),
  })
}

app.get('/api/scheduler', sendData)
app.get('/api/version', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json({ version: serverVersion })
})
app.get('/api/training-videos', async (_request, response) => {
  const catalog = await readTrainingVideoCatalog()
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json(catalog)
})
app.get('/api/instructors', async (_request, response) => {
  const data = await store.read()
  const recipientConfig = await readEmailRecipientConfig()
  const instructors = new Set<string>([TEST_INSTRUCTOR_EMAIL, ...Object.values(DELL_ONLY_INSTRUCTOR_EMAILS)])
  Object.values(recipientConfig).forEach((trainingRecipients) => {
    Object.values(trainingRecipients).forEach((email) => instructors.add(String(email).trim().toLowerCase()))
  })
  data.bookings.forEach((booking) => {
    if (booking.instructorEmail) instructors.add(booking.instructorEmail.trim().toLowerCase())
  })
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json({ instructors: Array.from(instructors).filter(Boolean).sort() })
})
app.get('/api/instructor-preview', async (request, response) => {
  const trainingId = String(request.query.trainingId ?? '')
  const oem = request.query.oem ? String(request.query.oem) : undefined
  const odm = request.query.odm ? String(request.query.odm) : undefined
  if (!trainingId) return response.status(400).json({ error: 'REQUIRED_FIELDS_MISSING' })
  if (dellOnlyInstructorEmail(trainingId)) return response.json({ instructorEmail: oem === DELL_ONLY_OEM ? dellOnlyInstructorEmail(trainingId) : null })
  if (trainingId === 'killer' && oem === DELL_ONLY_OEM) return response.json({ instructorEmail: TEST_INSTRUCTOR_EMAIL })
  const instructorEmail = await getExplicitCFEContactEmail(trainingId, oem, odm)
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json({ instructorEmail })
})
app.get('/api/bookings', async (request, response) => {
  const email = String(request.query.email ?? '').trim().toLowerCase()
  if (!email) return response.status(400).json({ error: 'REQUESTER_EMAIL_REQUIRED' })
  const data = await store.read()
  const trainings = new Map(data.trainings.map((training) => [training.id, training]))
  const sessions = new Map(data.sessions.map((session) => [session.id, session]))
  const recipientConfig = await readEmailRecipientConfig()
  const matches = data.bookings
    .filter((booking) => (booking.status === 'confirmed' || booking.status === 'pending') && booking.requesterEmail.toLowerCase() === email)
    .map((booking) => {
      const trainingId = booking.trainingId ?? sessions.get(booking.sessionId)?.trainingId
      const instructorEmail = booking.instructorEmail ?? dellOnlyInstructorEmail(trainingId) ?? (trainingId ? getCFEContactEmailFromConfig(trainingId, booking.oem, booking.odm ?? 'NA', recipientConfig) ?? undefined : undefined)
      return { ...booking, instructorEmail, session: sessions.get(booking.sessionId), training: trainingId ? trainings.get(trainingId) : undefined }
    })
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json({ bookings: matches })
})
app.post('/api/auth/login', (request, response) => {
  if (request.body?.password !== password) return response.status(401).json({ error: 'INVALID_PASSWORD' })
  response.cookie('scheduler', 'true', { signed: true, httpOnly: true, sameSite: 'strict', secure: tlsEnabled })
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
    if (!/^2026-(09-(1[4-9]|2[0-9])|10-(0[1-9]|[12][0-9]|30))$/.test(date) || weekday === 0 || weekday === 6 || !/^\d{2}:(00|30)$/.test(startTime) || startMinutes < 540 || startMinutes > 1020) throw new Error('INVALID_SESSION_TIME')
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

// An instructor may record attendance if they are mapped to the session's training, are the
// explicit instructor on one of its bookings, or own the always-available BIOS SAR training.
const authorizedInstructorEmails = async (data: Awaited<ReturnType<typeof store.read>>, sessionId: string) => {
  const session = data.sessions.find((item) => item.id === sessionId)
  if (!session) return null
  const recipientConfig = await readEmailRecipientConfig()
  const emails = new Set<string>()
  const addMappedInstructors = (trainingId: string) => {
    const fixedInstructor = dellOnlyInstructorEmail(trainingId)
    if (fixedInstructor) emails.add(fixedInstructor)
    Object.values(recipientConfig[trainingId] ?? {}).forEach((email) => emails.add(String(email).trim().toLowerCase()))
  }
  addMappedInstructors(session.trainingId)
  data.bookings
    .filter((booking) => booking.sessionId === sessionId && booking.status === 'confirmed')
    .forEach((booking) => {
      const trainingId = booking.trainingId ?? session.trainingId
      addMappedInstructors(trainingId)
      if (booking.instructorEmail) emails.add(booking.instructorEmail.trim().toLowerCase())
      const mapped = getCFEContactEmailFromConfig(trainingId, booking.oem, booking.odm ?? 'NA', recipientConfig)
      if (mapped) emails.add(mapped.trim().toLowerCase())
    })
  return emails
}

app.get('/api/sessions/:id/attendance-access', async (request, response) => {
  const instructorEmail = String(request.query.instructorEmail ?? '').trim().toLowerCase()
  if (!isEmail(instructorEmail)) return response.status(400).json({ error: 'INVALID_INSTRUCTOR_EMAIL' })
  const allowedEmails = await authorizedInstructorEmails(await store.read(), request.params.id)
  if (!allowedEmails) return response.status(404).json({ error: 'SESSION_NOT_FOUND' })
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  response.json({ authorized: allowedEmails.has(instructorEmail) })
})

app.post('/api/sessions/:id/attendance', async (request, response) => {
  const instructorEmail = String(request.body?.instructorEmail ?? '').trim().toLowerCase()
  const attendeeCount = Number(request.body?.attendeeCount)
  const notes = typeof request.body?.notes === 'string' ? request.body.notes.trim().slice(0, 500) : ''
  if (!instructorEmail) return response.status(400).json({ error: 'REQUIRED_FIELDS_MISSING' })
  if (!isEmail(instructorEmail)) return response.status(400).json({ error: 'INVALID_INSTRUCTOR_EMAIL' })
  if (!Number.isInteger(attendeeCount) || attendeeCount < 0 || attendeeCount > 1000) return response.status(400).json({ error: 'INVALID_ATTENDANCE_COUNT' })

  const current = await store.read()
  const allowedEmails = await authorizedInstructorEmails(current, request.params.id)
  if (!allowedEmails) return response.status(404).json({ error: 'SESSION_NOT_FOUND' })
  if (!allowedEmails.has(instructorEmail)) return response.status(403).json({ error: 'NOT_SESSION_INSTRUCTOR' })

  let record: AttendanceRecord | undefined
  await store.update((data) => {
    const session = data.sessions.find((item) => item.id === request.params.id)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    data.attendance ??= []
    const now = new Date().toISOString()
    const existing = data.attendance.find((item) => item.sessionId === session.id && item.instructorEmail === instructorEmail)
    if (existing) {
      existing.attendeeCount = attendeeCount
      existing.notes = notes || undefined
      existing.updatedAt = now
      record = existing
    } else {
      record = {
        id: randomUUID(),
        sessionId: session.id,
        trainingId: session.trainingId,
        attendeeCount,
        instructorEmail,
        notes: notes || undefined,
        recordedAt: now,
        updatedAt: now,
      }
      data.attendance.push(record)
    }
  })

  response.status(201).json(record)
})

app.post('/api/bookings', async (request, response) => {
  const { sessionId, trainingId, oem, odm, trainingFormat, requesterName, requesterEmail, instructorEmail: requestedInstructorEmail } = request.body ?? {}
  if (!sessionId || !oem || !odm || !trainingFormat || !requesterName || !requesterEmail) return response.status(400).json({ error: 'REQUIRED_FIELDS_MISSING' })
  const normalizedRequesterEmail = String(requesterEmail).trim().toLowerCase()
  if (!isEmail(normalizedRequesterEmail)) return response.status(400).json({ error: 'INVALID_REQUESTER_EMAIL' })
  const selectedOem = String(oem)
  const selectedOdm = String(odm)
  const selectedTrainingFormat = String(trainingFormat)
  const selectedInstructorEmail = typeof requestedInstructorEmail === 'string' ? requestedInstructorEmail.trim().toLowerCase() : undefined
  if (selectedInstructorEmail && !isEmail(selectedInstructorEmail)) return response.status(400).json({ error: 'INVALID_INSTRUCTOR_EMAIL' })
  if (!OEM_OPTIONS.has(selectedOem) || !ODM_OPTIONS.has(selectedOdm)) return response.status(400).json({ error: 'INVALID_CUSTOMER_SELECTION' })
  if (!TRAINING_FORMAT_OPTIONS.has(selectedTrainingFormat)) return response.status(400).json({ error: 'INVALID_TRAINING_FORMAT' })

  const preCheckData = await store.read()
  const preCheckSession = preCheckData.sessions.find((item) => item.id === sessionId && item.status === 'active')
  const requestedTrainingId = typeof trainingId === 'string' ? trainingId : preCheckSession?.trainingId
  if (!preCheckSession || !requestedTrainingId || (requestedTrainingId !== preCheckSession.trainingId && !DELL_ONLY_TRAINING_IDS.has(requestedTrainingId))) return response.status(400).json({ error: 'SESSION_NOT_FOUND' })
  if (preCheckSession.date > DELL_ONLY_PERIOD_AFTER && selectedOem !== DELL_ONLY_OEM) return response.status(400).json({ error: 'DELL_ONLY_PERIOD' })
  if (dellOnlyInstructorEmail(requestedTrainingId) && selectedOem !== DELL_ONLY_OEM) return response.status(400).json({ error: 'INVALID_CUSTOMER_SELECTION' })
  const preCheckTraining = preCheckData.trainings.find((item) => item.id === requestedTrainingId)
  if (!preCheckTraining) return response.status(400).json({ error: 'SESSION_NOT_FOUND' })
  const fixedInstructorEmail = dellOnlyInstructorEmail(requestedTrainingId)
  if (fixedInstructorEmail && selectedInstructorEmail && selectedInstructorEmail !== fixedInstructorEmail) return response.status(400).json({ error: 'FIXED_INSTRUCTOR_REQUIRED' })
  const instructorEmail = fixedInstructorEmail ?? selectedInstructorEmail ?? await getExplicitCFEContactEmail(preCheckTraining.id, selectedOem, selectedOdm) ?? undefined
  if (preCheckTraining && !instructorEmail) return response.status(400).json({ error: 'NO_INSTRUCTOR_MAPPED' })

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
      return (existing.trainingId ?? existingSession?.trainingId) === requestedTrainingId
    })
    if (hasDuplicateTopicCustomerBooking) throw new Error('DUPLICATE_TOPIC_CUSTOMER_BOOKING')

    training = data.trainings.find((item) => item.id === requestedTrainingId)
    booking = {
      id: randomUUID(),
      sessionId,
      trainingId: requestedTrainingId === session.trainingId ? undefined : requestedTrainingId,
      oem: selectedOem,
      odm: selectedOdm,
      trainingFormat: selectedTrainingFormat as Booking['trainingFormat'],
      requesterName,
      requesterEmail: normalizedRequesterEmail,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      instructorEmail,
    }
    data.bookings.push(booking)
  })

  try {
    if (booking && session && training) {
      await sendBookingNotificationEmail(
        {
          bookingId: booking.id,
          sessionId: booking.sessionId,
          trainingId: training.id,
          trainingTitle: training.title,
          sessionDate: session.date,
          sessionTime: session.startTime,
          durationMinutes: session.durationMinutes,
          oem: booking.oem,
          odm: booking.odm,
          trainingFormat: booking.trainingFormat,
          requesterName: booking.requesterName,
          requesterEmail: booking.requesterEmail,
          createdAt: booking.createdAt,
          instructorEmail,
        },
        instructorEmail ?? undefined,
      )
    }
  } catch (error) {
    console.error('Failed to send booking notification email:', error)
  }

  response.status(201).json({ ...booking, instructorEmail })
})

app.delete('/api/bookings', requireScheduler, async (_request, response) => {
  let cleared = 0
  await store.update((data) => {
    const cancelledAt = new Date().toISOString()
    data.bookings.forEach((booking) => {
      if (isSystemUnavailableBooking(booking)) return
      if (booking.status !== 'confirmed' && booking.status !== 'pending') return
      booking.status = 'cancelled'
      booking.cancelledAt = cancelledAt
      cleared += 1
    })
  })
  response.json({ cleared })
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
  const email = String(request.body?.requesterEmail ?? '').trim().toLowerCase()
  let booking: Booking | undefined
  let session: Awaited<ReturnType<typeof store.read>>['sessions'][0] | undefined
  let training: Awaited<ReturnType<typeof store.read>>['trainings'][0] | undefined
  await store.update((data) => {
    booking = data.bookings.find((item) => item.id === request.params.id && item.requesterEmail.trim().toLowerCase() === email && item.status === 'confirmed')
    if (!booking) throw new Error('BOOKING_NOT_FOUND')
    session = data.sessions.find((item) => item.id === booking!.sessionId)
    training = session ? data.trainings.find((item) => item.id === (booking!.trainingId ?? session!.trainingId)) : undefined
    booking.status = 'cancelled'
    booking.cancelledAt = new Date().toISOString()
  })

  try {
    if (booking && session && training) {
      const instructorEmail = await instructorForTraining(training.id, booking.oem, booking.odm ?? 'NA')
      await sendBookingCancellationNotificationEmail(
        booking.requesterEmail,
        booking.requesterName,
        training.title,
        session.date,
        session.startTime,
        instructorEmail ?? undefined,
      )
    }
  } catch (error) {
    console.error('Failed to send booking cancellation notification email:', error)
  }

  response.status(204).end()
})

app.put('/api/bookings/:id/instructor', async (request, response) => {
  const requesterEmail = String(request.body?.requesterEmail ?? '').trim().toLowerCase()
  const instructorEmail = String(request.body?.instructorEmail ?? '').trim().toLowerCase()
  if (!requesterEmail || !instructorEmail) return response.status(400).json({ error: 'REQUIRED_FIELDS_MISSING' })
  if (!isEmail(instructorEmail)) return response.status(400).json({ error: 'INVALID_INSTRUCTOR_EMAIL' })
  let booking: Booking | undefined
  let session: Awaited<ReturnType<typeof store.read>>['sessions'][0] | undefined
  let training: Awaited<ReturnType<typeof store.read>>['trainings'][0] | undefined
  await store.update((data) => {
    booking = data.bookings.find((item) => item.id === request.params.id && item.requesterEmail.trim().toLowerCase() === requesterEmail && item.status === 'confirmed')
    if (!booking) throw new Error('BOOKING_NOT_FOUND')
    session = data.sessions.find((item) => item.id === booking!.sessionId)
    training = session ? data.trainings.find((item) => item.id === (booking!.trainingId ?? session!.trainingId)) : undefined
    const fixedInstructor = dellOnlyInstructorEmail(training?.id)
    if (fixedInstructor && instructorEmail !== fixedInstructor) throw new Error('FIXED_INSTRUCTOR_REQUIRED')
    booking.instructorEmail = instructorEmail
  })

  try {
    if (booking && session && training) {
      await sendInstructorUpdateNotificationEmail(
        {
          bookingId: booking.id,
          sessionId: booking.sessionId,
          trainingId: training.id,
          trainingTitle: training.title,
          sessionDate: session.date,
          sessionTime: session.startTime,
          durationMinutes: session.durationMinutes,
          oem: booking.oem,
          odm: booking.odm,
          trainingFormat: booking.trainingFormat,
          requesterName: booking.requesterName,
          requesterEmail: booking.requesterEmail,
          createdAt: booking.createdAt,
          instructorEmail,
        },
        instructorEmail,
      )
    }
  } catch (error) {
    console.error('Failed to send instructor update notification email:', error)
  }

  response.json({ ...booking, instructorEmail })
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
if (tlsEnabled) {
  const credentials = {
    key: readFileSync(tlsKeyFile!),
    cert: readFileSync(tlsCertFile!),
    ...(process.env.TLS_CA_FILE ? { ca: readFileSync(process.env.TLS_CA_FILE) } : {}),
    ...(process.env.TLS_PASSPHRASE ? { passphrase: process.env.TLS_PASSPHRASE } : {}),
  }
  https.createServer(credentials, app).listen(port, () => console.log(`Training Scheduler listening on https port ${port}`))
  if (httpRedirectPort) {
    http
      .createServer((request, response) => {
        const host = (request.headers.host ?? '').replace(/:\d+$/, '')
        response.writeHead(301, { Location: `https://${host}${port === 443 ? '' : `:${port}`}${request.url ?? '/'}` })
        response.end()
      })
      .listen(httpRedirectPort, () => console.log(`Redirecting http port ${httpRedirectPort} to https`))
  }
} else {
  app.listen(port, () => console.log(`Training Scheduler listening on port ${port}`))
}
