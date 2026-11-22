export function notificationPath(notification) {
  const id = notification.relatedEntityId
  if (notification.relatedEntityType === 'lesson' && id) return `/app/learning/${id}`
  if (notification.relatedEntityType === 'assignment' && id) return `/app/assignments/${id}`
  if (notification.relatedEntityType === 'quiz' && id) return '/app/quizzes'
  if ((notification.relatedEntityType === 'conversation' || notification.relatedEntityType === 'message') && id) return `/app/messages/${id}`
  return '/app/notifications'
}
