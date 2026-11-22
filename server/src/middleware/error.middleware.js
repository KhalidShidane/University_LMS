export function notFound(req, res, next) {
  res.status(404).json({ success: false, message: 'Route not found' })
}

export function errorHandler(err, req, res, next) {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Request body must be valid JSON' })
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body is too large' })
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    const isPhotoUpload = req.originalUrl.includes('/api/profile/')
    const isLessonUpload = req.originalUrl.includes('/lessons/')
    const isAssignmentAttachment = req.originalUrl.includes('/assignments/') && req.originalUrl.includes('/attachments')
    const limit = isAssignmentAttachment ? process.env.ASSIGNMENT_ATTACHMENT_MAX_FILE_SIZE || String(15 * 1024 * 1024) : process.env.ASSIGNMENT_MAX_FILE_SIZE || String(10 * 1024 * 1024)
    const megabytes = Math.max(1, Math.floor(Number(limit) / 1024 / 1024))
    return res.status(413).json({ success: false, message: isPhotoUpload ? 'Profile photos must be 5 MB or smaller' : isLessonUpload ? 'Lesson files must be 10 MB or smaller' : `Uploaded file must be ${megabytes} MB or smaller` })
  }
  if (typeof err?.code === 'string' && err.code.startsWith('LIMIT_')) {
    const isLessonUpload = req.originalUrl.includes('/lessons/')
    return res.status(400).json({ success: false, message: isLessonUpload ? 'Upload up to 8 lesson files at a time' : req.originalUrl.includes('/assignments/') && req.originalUrl.includes('/attachments') ? 'Upload no more than 5 assignment attachments at a time' : 'Upload must contain one PDF file' })
  }

  if (err?.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {})
    return res.status(409).json({
      success: false,
      message: 'A record with one of these unique values already exists',
      fields,
    })
  }

  if (err?.name === 'ValidationError') {
    const fields = Object.fromEntries(
      Object.keys(err.errors || {}).map((field) => [field, 'Invalid or missing value']),
    )
    return res.status(400).json({ success: false, message: 'Validation failed', fields })
  }

  if (err?.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid value for ${err.path}` })
  }

  if (err?.name === 'ReferenceIntegrityError') {
    return res.status(400).json({ success: false, message: err.message, field: err.field })
  }

  if (err?.name === 'AcademicStructureError') {
    return res.status(err.status).json({ success: false, message: err.message })
  }

  if (err?.name === 'AcademicRecordInUseError') {
    return res.status(409).json({ success: false, message: err.message })
  }

  const status = Number(err.status) || 500
  return res.status(status).json({
    success: false,
    message: status >= 500 ? 'An unexpected server error occurred' : err.message,
  })
}
