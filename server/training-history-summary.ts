// Pure module (no Node imports) so the browser can recompute summaries for filtered views.
export type HistoryBooking = {
  bookingId: string
  oem: string
  odm?: string
  trainingFormat?: 'with-video' | 'without-video'
  requesterName: string
  requesterEmail: string
  instructorEmail?: string
  createdAt: string
  cancelledAt?: string
}

export type HistoryAttendance = {
  instructorEmail: string
  attendeeCount: number
  notes?: string
  recordedAt: string
}

export type HistorySession = {
  sessionId: string
  trainingId: string
  trainingTitle: string
  hidden: boolean
  date: string
  startTime: string
  durationMinutes: number
  status: 'active' | 'cancelled'
  bookings: HistoryBooking[]
  cancelledBookings: HistoryBooking[]
  attendance: HistoryAttendance[]
  attendeeCount: number
  attendanceRecorded: boolean
  turnoutRatio: number | null
  instructors: string[]
  notes: string[]
}

export type TrainingHistory = {
  sessions: HistorySession[]
}

export type OemCoverage = { oem: string; odms: string[]; sessions: number; bookings: number }

export type CourseSummary = {
  trainingId: string
  trainingTitle: string
  hidden: boolean
  sessionsHeld: number
  confirmedBookings: number
  attendees: number
  turnoutRatio: number | null
  cancelledSessions: number
  cancelledBookings: number
  oemsTrained: OemCoverage[]
  oemsNeverTrained: string[]
}

export type TrainingHistorySummary = {
  totals: Omit<CourseSummary, 'trainingId' | 'trainingTitle' | 'hidden' | 'oemsTrained' | 'oemsNeverTrained'> & { attendanceGaps: number }
  courses: CourseSummary[]
  gaps: HistorySession[]
}

export const isHeld = (session: HistorySession) => session.status === 'active' && (session.bookings.length > 0 || session.attendanceRecorded)
const isGap = (session: HistorySession) => session.status === 'active' && session.bookings.length > 0 && !session.attendanceRecorded
const ratio = (attendees: number, bookings: number) => (bookings ? attendees / bookings : null)

const countSessions = (sessions: HistorySession[]) => {
  const held = sessions.filter(isHeld)
  const confirmedBookings = held.reduce((total, session) => total + session.bookings.length, 0)
  const attendees = held.reduce((total, session) => total + session.attendeeCount, 0)
  return {
    sessionsHeld: held.length,
    confirmedBookings,
    attendees,
    turnoutRatio: ratio(attendees, confirmedBookings),
    cancelledSessions: sessions.filter((session) => session.status === 'cancelled').length,
    cancelledBookings: sessions.reduce((total, session) => total + session.cancelledBookings.length, 0),
  }
}

export function summarizeTrainingHistory(sessions: HistorySession[], oemOptions: readonly string[]): TrainingHistorySummary {
  const byCourse = new Map<string, HistorySession[]>()
  sessions.forEach((session) => byCourse.set(session.trainingId, [...(byCourse.get(session.trainingId) ?? []), session]))
  const courses = Array.from(byCourse.values()).map((courseSessions): CourseSummary => {
    const coverage = new Map<string, { odms: Set<string>; sessions: Set<string>; bookings: number }>()
    courseSessions.filter(isHeld).forEach((session) =>
      session.bookings.forEach((item) => {
        const entry = coverage.get(item.oem) ?? { odms: new Set<string>(), sessions: new Set<string>(), bookings: 0 }
        if (item.odm && item.odm !== 'NA') entry.odms.add(item.odm)
        entry.sessions.add(session.sessionId)
        entry.bookings += 1
        coverage.set(item.oem, entry)
      }),
    )
    const [first] = courseSessions
    return {
      trainingId: first.trainingId,
      trainingTitle: first.trainingTitle,
      hidden: first.hidden,
      ...countSessions(courseSessions),
      oemsTrained: Array.from(coverage, ([oem, entry]) => ({
        oem,
        odms: Array.from(entry.odms).sort(),
        sessions: entry.sessions.size,
        bookings: entry.bookings,
      })).sort((left, right) => left.oem.localeCompare(right.oem)),
      oemsNeverTrained: oemOptions.filter((oem) => oem !== 'NA' && !coverage.has(oem)),
    }
  })
  const gaps = sessions.filter(isGap)
  return { totals: { ...countSessions(sessions), attendanceGaps: gaps.length }, courses, gaps }
}
