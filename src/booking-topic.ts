export type BookingTopicLike = {
  sessionId?: string
  trainingId?: string
}

export function resolveDisplayTrainingId(
  sessionTrainingId: string | undefined,
  bookings: BookingTopicLike[] = [],
  sessionId?: string,
): string | undefined {
  const customTopic = bookings
    .filter((booking) => booking.sessionId === sessionId && booking.trainingId && booking.trainingId !== sessionTrainingId)
    .at(-1)

  return customTopic?.trainingId ?? sessionTrainingId
}
