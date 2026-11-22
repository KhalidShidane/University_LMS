const streams = new Map()

export function addNotificationStream(userId, response) {
  const key = String(userId)
  const recipients = streams.get(key) || new Set()
  recipients.add(response)
  streams.set(key, recipients)
  return () => {
    recipients.delete(response)
    if (!recipients.size) streams.delete(key)
  }
}

export function emitNotification(userId, notification) {
  const recipients = streams.get(String(userId))
  if (!recipients) return
  const event = `id: ${notification._id}\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`
  for (const response of recipients) {
    try { response.write(event) } catch {
      recipients.delete(response)
    }
  }
  if (!recipients.size) streams.delete(String(userId))
}

export function closeAllNotificationStreams() {
  for (const recipients of streams.values()) for (const response of recipients) response.end()
  streams.clear()
}
