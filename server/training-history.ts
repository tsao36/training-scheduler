import type { Booking, SchedulerData } from './data-store.js'
import { resolveDisplayTrainingId } from './booking-topic.js'
import type { HistoryBooking, HistorySession, TrainingHistory } from './training-history-summary.js'

export * from './training-history-summary.js'

const isSystemBlockBooking = (booking: Booking) =>
  booking.requesterEmail === 'scheduler-block@local' || booking.requesterName === 'System Block' || booking.oem === 'Not available'

const toHistoryBooking = (booking: Booking): HistoryBooking => ({
  bookingId: booking.id,
  oem: booking.oem,
  ...(booking.odm ? { odm: booking.odm } : {}),
  ...(booking.trainingFormat ? { trainingFormat: booking.trainingFormat } : {}),
  requesterName: booking.requesterName,
  requesterEmail: booking.requesterEmail,
  ...(booking.instructorEmail ? { instructorEmail: booking.instructorEmail } : {}),
  createdAt: booking.createdAt,
  ...(booking.cancelledAt ? { cancelledAt: booking.cancelledAt } : {}),
})

export function buildTrainingHistory(
  data: SchedulerData,
  today: string,
  options: { hiddenTrainingIds?: Iterable<string> } = {},
): TrainingHistory {
  const hiddenTrainingIds = new Set(options.hiddenTrainingIds ?? [])
  const trainings = new Map(data.trainings.map((training) => [training.id, training]))
  const realBookings = data.bookings.filter((item) => !isSystemBlockBooking(item))
  const sessions = data.sessions
    .filter((session) => session.date < today)
    .map((session): HistorySession => {
      const sessionBookings = realBookings.filter((item) => item.sessionId === session.id)
      const confirmed = sessionBookings.filter((item) => item.status === 'confirmed')
      const bookings = confirmed.map(toHistoryBooking)
      const cancelledBookings = sessionBookings.filter((item) => item.status === 'cancelled').map(toHistoryBooking)
      const attendance = (data.attendance ?? [])
        .filter((record) => record.sessionId === session.id)
        .map((record) => ({
          instructorEmail: record.instructorEmail,
          attendeeCount: record.attendeeCount,
          ...(record.notes ? { notes: record.notes } : {}),
          recordedAt: record.recordedAt,
        }))
      const attendanceEstimated = attendance.length === 0 && session.estimatedAttendeeCount !== undefined
      const attendeeCount = attendanceEstimated ? (session.estimatedAttendeeCount ?? 0) : attendance.reduce((total, record) => total + record.attendeeCount, 0)
      const trainingId = resolveDisplayTrainingId(session.trainingId, confirmed, session.id) ?? session.trainingId
      const instructors = attendance.length
        ? attendance.map((record) => record.instructorEmail)
        : bookings.flatMap((item) => (item.instructorEmail ? [item.instructorEmail] : []))
      const notes: string[] = []
      if (!bookings.length && attendance.length) notes.push('Attendance recorded but no confirmed bookings')
      if (attendanceEstimated) notes.push('Estimated attendance')
      return {
        sessionId: session.id,
        trainingId,
        trainingTitle: trainings.get(trainingId)?.title ?? trainingId,
        hidden: hiddenTrainingIds.has(trainingId),
        date: session.date,
        startTime: session.startTime,
        durationMinutes: session.durationMinutes,
        status: session.status,
        bookings,
        cancelledBookings,
        attendance,
        attendeeCount,
        attendanceRecorded: attendance.length > 0 || attendanceEstimated,
        ...(attendanceEstimated ? { attendanceEstimated: true } : {}),
        turnoutRatio: bookings.length ? attendeeCount / bookings.length : null,
        instructors: Array.from(new Set(instructors.map((email) => email.trim().toLowerCase()))),
        notes,
      }
    })
    .filter((session) => session.bookings.length || session.cancelledBookings.length || session.attendanceRecorded)
  return { sessions }
}
