export type BookingTopicLike = {
  sessionId?: string
  trainingId?: string
  oem?: string
}

export function resolveDisplayTrainingId(
  sessionTrainingId: string | undefined,
  bookings: BookingTopicLike[] = [],
  sessionId?: string,
): string | undefined {
  const sessionBookings = bookings.filter((booking) => booking.sessionId === sessionId)
  const customBookings = sessionBookings.filter(
    (booking) => booking.trainingId && booking.trainingId !== sessionTrainingId,
  )
  const dellCustomTopic = customBookings
    .filter((booking) => booking.oem === 'Dell')
    .at(-1)
  const customTopic = customBookings
    .at(-1)

  return dellCustomTopic?.trainingId ?? customTopic?.trainingId ?? sessionTrainingId
}
