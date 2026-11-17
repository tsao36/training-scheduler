import assert from 'node:assert/strict'
import test from 'node:test'
import type { Booking, SchedulerData } from './data-store.js'
import { buildTrainingHistory, isHeld, summarizeTrainingHistory } from './training-history.js'

const baseData = (overrides: Partial<SchedulerData> = {}): SchedulerData => ({
  window: { start: '2026-09-14', end: '2026-10-30', durationMinutes: 60 },
  trainings: [
    { id: 'wifi-8', title: 'WiFi 8 Training', shortTitle: 'WiFi 8', instructor: 'KJ', accent: 'blue', mode: 'Live' },
    { id: 'killer', title: 'Killer Training', shortTitle: 'Killer', instructor: 'Richard', accent: 'mint', mode: 'Live' },
  ],
  sessions: [],
  bookings: [],
  attendance: [],
  version: 1,
  ...overrides,
})

const booking = (overrides: Partial<Booking>): Booking => ({
  id: 'b1',
  sessionId: 's1',
  oem: 'Dell',
  requesterName: 'Alice',
  requesterEmail: 'alice@example.com',
  createdAt: '2026-09-01T00:00:00.000Z',
  status: 'confirmed',
  ...overrides,
})

test('includes only sessions dated before today, with confirmed bookings only', () => {
  const data = baseData({
    sessions: [
      { id: 's1', trainingId: 'wifi-8', date: '2026-10-01', startTime: '10:00', durationMinutes: 60, status: 'active' },
      { id: 's2', trainingId: 'wifi-8', date: '2026-11-13', startTime: '10:00', durationMinutes: 60, status: 'active' },
    ],
    bookings: [
      booking({ id: 'b1', sessionId: 's1' }),
      booking({ id: 'b2', sessionId: 's1', status: 'pending', requesterEmail: 'pending@example.com' }),
      booking({ id: 'b3', sessionId: 's2' }),
    ],
  })

  const history = buildTrainingHistory(data, '2026-11-13')

  assert.deepEqual(history.sessions.map((session) => session.sessionId), ['s1'])
  assert.deepEqual(history.sessions[0].bookings.map((item) => item.bookingId), ['b1'])
})

test('turnout ratio sums attendance records and treats a missing record as 0 attendees', () => {
  const data = baseData({
    sessions: [
      { id: 's1', trainingId: 'wifi-8', date: '2026-10-01', startTime: '10:00', durationMinutes: 60, status: 'active' },
      { id: 's2', trainingId: 'wifi-8', date: '2026-10-02', startTime: '10:00', durationMinutes: 60, status: 'active' },
    ],
    bookings: [
      booking({ id: 'b1', sessionId: 's1', oem: 'Dell' }),
      booking({ id: 'b2', sessionId: 's1', oem: 'HP' }),
      booking({ id: 'b3', sessionId: 's2' }),
    ],
    attendance: [
      { id: 'a1', sessionId: 's1', trainingId: 'wifi-8', attendeeCount: 5, instructorEmail: 'kj@example.com', recordedAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z' },
      { id: 'a2', sessionId: 's1', trainingId: 'wifi-8', attendeeCount: 3, instructorEmail: 'frank@example.com', notes: 'Good QnA', recordedAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z' },
    ],
  })

  const [first, second] = buildTrainingHistory(data, '2026-11-13').sessions

  assert.equal(first.attendeeCount, 8)
  assert.equal(first.turnoutRatio, 4)
  assert.equal(first.attendanceRecorded, true)
  assert.equal(second.attendeeCount, 0)
  assert.equal(second.turnoutRatio, 0)
  assert.equal(second.attendanceRecorded, false)
})

test('keeps a session with attendance but no confirmed bookings and flags it; drops unused empty slots', () => {
  const data = baseData({
    sessions: [
      { id: 's1', trainingId: 'wifi-8', date: '2026-10-01', startTime: '10:00', durationMinutes: 60, status: 'active' },
      { id: 's2', trainingId: 'wifi-8', date: '2026-10-01', startTime: '11:00', durationMinutes: 60, status: 'active' },
    ],
    bookings: [booking({ id: 'b1', sessionId: 's1', status: 'cancelled', cancelledAt: '2026-09-30T00:00:00.000Z' })],
    attendance: [
      { id: 'a1', sessionId: 's1', trainingId: 'wifi-8', attendeeCount: 4, instructorEmail: 'kj@example.com', recordedAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z' },
    ],
  })

  const history = buildTrainingHistory(data, '2026-11-13')

  assert.deepEqual(history.sessions.map((session) => session.sessionId), ['s1'])
  assert.equal(history.sessions[0].attendeeCount, 4)
  assert.equal(history.sessions[0].turnoutRatio, null)
  assert.deepEqual(history.sessions[0].notes, ['Attendance recorded but no confirmed bookings'])
})

test('tracks cancelled sessions and bookings separately and ignores system block bookings', () => {
  const data = baseData({
    sessions: [
      { id: 's1', trainingId: 'wifi-8', date: '2026-10-01', startTime: '10:00', durationMinutes: 60, status: 'cancelled' },
      { id: 's2', trainingId: 'wifi-8', date: '2026-10-02', startTime: '10:00', durationMinutes: 60, status: 'active' },
    ],
    bookings: [
      booking({ id: 'b1', sessionId: 's1', status: 'cancelled', cancelledAt: '2026-09-30T00:00:00.000Z' }),
      booking({ id: 'b2', sessionId: 's2', requesterName: 'System Block', requesterEmail: 'scheduler-block@local', oem: 'Not available' }),
    ],
  })

  const history = buildTrainingHistory(data, '2026-11-13')

  assert.equal(history.sessions.length, 1)
  assert.equal(history.sessions[0].sessionId, 's1')
  assert.equal(history.sessions[0].status, 'cancelled')
  assert.deepEqual(history.sessions[0].bookings, [])
  assert.deepEqual(history.sessions[0].cancelledBookings.map((item) => item.bookingId), ['b1'])
})

test('held sessions exclude cancelled-only bookings but retain recorded attendance', () => {
  const data = baseData({
    sessions: [
      { id: 's1', trainingId: 'wifi-8', date: '2026-10-01', startTime: '10:00', durationMinutes: 60, status: 'active' },
      { id: 's2', trainingId: 'wifi-8', date: '2026-10-01', startTime: '11:00', durationMinutes: 60, status: 'active' },
      { id: 's3', trainingId: 'wifi-8', date: '2026-10-01', startTime: '12:00', durationMinutes: 60, status: 'active' },
      { id: 's4', trainingId: 'wifi-8', date: '2026-10-01', startTime: '13:00', durationMinutes: 60, status: 'cancelled' },
    ],
    bookings: [
      booking({ id: 'b1', sessionId: 's1', status: 'cancelled' }),
      booking({ id: 'b2', sessionId: 's2' }),
      booking({ id: 'b3', sessionId: 's4' }),
    ],
    attendance: [
      { id: 'a1', sessionId: 's3', trainingId: 'wifi-8', attendeeCount: 2, instructorEmail: 'kj@example.com', recordedAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z' },
    ],
  })

  const history = buildTrainingHistory(data, '2026-11-13')

  assert.deepEqual(history.sessions.filter(isHeld).map((session) => session.sessionId), ['s2', 's3'])
})

test('uses estimated attendance until actual instructor attendance is recorded', () => {
  const data = baseData({
    sessions: [{ id: 's1', trainingId: 'wifi-8', date: '2026-10-01', startTime: '10:00', durationMinutes: 60, status: 'active', estimatedAttendeeCount: 0 }],
    bookings: [booking({ id: 'b1', sessionId: 's1', instructorEmail: 'kj@example.com' })],
  })

  const estimated = buildTrainingHistory(data, '2026-11-13').sessions[0]
  assert.equal(estimated.attendeeCount, 0)
  assert.equal(estimated.attendanceRecorded, true)
  assert.equal(estimated.attendanceEstimated, true)
  assert.deepEqual(estimated.instructors, ['kj@example.com'])
  assert.deepEqual(estimated.notes, ['Estimated attendance'])
  assert.equal(summarizeTrainingHistory([estimated], []).totals.attendanceGaps, 0)

  data.attendance = [{ id: 'a1', sessionId: 's1', trainingId: 'wifi-8', attendeeCount: 5, instructorEmail: 'kj@example.com', recordedAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z' }]
  const actual = buildTrainingHistory(data, '2026-11-13').sessions[0]
  assert.equal(actual.attendeeCount, 5)
  assert.equal(actual.attendanceEstimated, undefined)
  assert.deepEqual(actual.notes, [])
})

test('labels sessions with the displayed training, hidden flag, booking details and instructors', () => {
  const data = baseData({
    sessions: [
      { id: 's1', trainingId: 'wifi-8', date: '2026-10-01', startTime: '10:00', durationMinutes: 60, status: 'active' },
      { id: 's2', trainingId: 'wifi-8', date: '2026-10-02', startTime: '14:00', durationMinutes: 60, status: 'active' },
    ],
    bookings: [
      booking({ id: 'b1', sessionId: 's1', trainingId: 'killer', oem: 'Dell', odm: 'Compal', trainingFormat: 'without-video', instructorEmail: 'booked@example.com' }),
      booking({ id: 'b2', sessionId: 's2', oem: 'HP', instructorEmail: 'hp@example.com' }),
    ],
    attendance: [
      { id: 'a1', sessionId: 's1', trainingId: 'killer', attendeeCount: 2, instructorEmail: 'richard@example.com', notes: 'Needs follow-up', recordedAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T04:00:00.000Z' },
    ],
  })

  const [killer, wifi] = buildTrainingHistory(data, '2026-11-13', { hiddenTrainingIds: ['killer'] }).sessions

  assert.equal(killer.trainingId, 'killer')
  assert.equal(killer.trainingTitle, 'Killer Training')
  assert.equal(killer.hidden, true)
  assert.equal(killer.date, '2026-10-01')
  assert.equal(killer.startTime, '10:00')
  assert.deepEqual(killer.instructors, ['richard@example.com'])
  assert.deepEqual(killer.attendance, [{ instructorEmail: 'richard@example.com', attendeeCount: 2, notes: 'Needs follow-up', recordedAt: '2026-10-01T03:00:00.000Z' }])
  assert.deepEqual(killer.bookings, [{
    bookingId: 'b1',
    oem: 'Dell',
    odm: 'Compal',
    trainingFormat: 'without-video',
    requesterName: 'Alice',
    requesterEmail: 'alice@example.com',
    instructorEmail: 'booked@example.com',
    createdAt: '2026-09-01T00:00:00.000Z',
  }])
  assert.equal(wifi.trainingId, 'wifi-8')
  assert.equal(wifi.hidden, false)
  assert.deepEqual(wifi.instructors, ['hp@example.com'])
})

test('summarizes coverage, never-trained OEMs, turnout, cancellations and attendance gaps per course', () => {
  const data = baseData({
    sessions: [
      { id: 's1', trainingId: 'wifi-8', date: '2026-10-01', startTime: '10:00', durationMinutes: 60, status: 'active' },
      { id: 's2', trainingId: 'wifi-8', date: '2026-10-02', startTime: '10:00', durationMinutes: 60, status: 'active' },
      { id: 's3', trainingId: 'wifi-8', date: '2026-10-03', startTime: '10:00', durationMinutes: 60, status: 'cancelled' },
    ],
    bookings: [
      booking({ id: 'b1', sessionId: 's1', oem: 'Dell', odm: 'Compal' }),
      booking({ id: 'b2', sessionId: 's1', oem: 'HP' }),
      booking({ id: 'b3', sessionId: 's2', oem: 'Dell', odm: 'Quanta' }),
      booking({ id: 'b4', sessionId: 's3', oem: 'Acer', status: 'cancelled' }),
    ],
    attendance: [
      { id: 'a1', sessionId: 's1', trainingId: 'wifi-8', attendeeCount: 6, instructorEmail: 'kj@example.com', recordedAt: '2026-10-01T03:00:00.000Z', updatedAt: '2026-10-01T03:00:00.000Z' },
    ],
  })
  const { sessions } = buildTrainingHistory(data, '2026-11-13')

  const summary = summarizeTrainingHistory(sessions, ['Dell', 'HP', 'Acer', 'NA'])

  assert.deepEqual(summary.totals, {
    sessionsHeld: 2,
    confirmedBookings: 3,
    attendees: 6,
    turnoutRatio: 2,
    cancelledSessions: 1,
    cancelledBookings: 1,
    attendanceGaps: 1,
  })
  assert.equal(summary.courses.length, 1)
  const [course] = summary.courses
  assert.equal(course.trainingId, 'wifi-8')
  assert.equal(course.sessionsHeld, 2)
  assert.equal(course.turnoutRatio, 2)
  assert.deepEqual(course.oemsTrained, [
    { oem: 'Dell', odms: ['Compal', 'Quanta'], sessions: 2, bookings: 2 },
    { oem: 'HP', odms: [], sessions: 1, bookings: 1 },
  ])
  assert.deepEqual(course.oemsNeverTrained, ['Acer'])
  assert.deepEqual(summary.gaps.map((session) => session.sessionId), ['s2'])
})
