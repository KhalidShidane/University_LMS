// Notification email templates. Each returns { subject, html, text } from a plain data snapshot.
import { ICONS, escapeHtml, renderEmailLayout } from './layout.js'

export function formatDateTime(value, timezone = 'UTC') {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC', timeZoneName: 'short' }).format(date)
  }
}

const shorten = (value, max = 600) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'
const greeting = (data) => `Hello ${escapeHtml(firstName(data.recipientName))},<br><br>`
// Renders "Label: value" rows; empty values are skipped.
const details = (rows) => {
  const visible = rows.filter(([, value]) => value)
  if (!visible.length) return ''
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:16px 0 0;border:1px solid #e2e8f0;border-radius:8px">${visible.map(([label, value], index) => `<tr><td style="padding:10px 12px;${index ? 'border-top:1px solid #e2e8f0;' : ''}font-size:13px;color:#64748b;width:38%;vertical-align:top">${escapeHtml(label)}</td><td style="padding:10px 12px;${index ? 'border-top:1px solid #e2e8f0;' : ''}font-size:14px;color:#0f172a;font-weight:600">${escapeHtml(value)}</td></tr>`).join('')}</table>`
}
const quote = (value) => (value ? `<div style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #1f6feb;border-radius:4px;font-size:14px;line-height:1.6;color:#334155;white-space:pre-line">${escapeHtml(shorten(value))}</div>` : '')
const textRows = (rows) => rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`)
const preferenceNote = 'You receive this email because you are enrolled in this class on DARSIVO. You can change optional email notifications in your profile settings.'

function build({ subject, preheader, heading, heroIcon = '', intro, rows = [], body = '', actionLabel, url, plain = [] }, data) {
  const html = renderEmailLayout({
    preheader,
    heading,
    heroIcon,
    bodyHtml: `${greeting(data)}${intro}${details(rows)}${quote(body)}`,
    action: url ? { label: actionLabel, url } : undefined,
    footnoteHtml: escapeHtml(preferenceNote),
  })
  const text = [`Hello ${firstName(data.recipientName)},`, '', intro.replace(/<[^>]+>/g, ''), '', ...textRows(rows), ...(body ? ['', shorten(body)] : []), ...plain, '', url ? `${actionLabel}: ${url}` : '', '', preferenceNote].join('\n')
  return { subject, html, text }
}

const templates = {
  quiz_published: (data) => build({
    heroIcon: ICONS.quiz,
    subject: `New quiz: ${data.title}`,
    preheader: `${data.title} is now available${data.dueDate ? ` until ${formatDateTime(data.dueDate, data.timezone)}` : ''}.`,
    heading: 'A new quiz is available',
    intro: `Your teacher published a new quiz: <strong>${escapeHtml(data.title)}</strong>.`,
    rows: [['Quiz', data.title], [data.contextType || 'Class', data.contextName], ['Opens', formatDateTime(data.availableFrom, data.timezone)], ['Deadline', formatDateTime(data.dueDate, data.timezone) || 'No deadline'], ['Time limit', data.durationMinutes ? `${data.durationMinutes} minutes` : '']],
    body: data.instructions,
    actionLabel: 'Open quiz',
    url: data.url,
  }, data),

  assignment_published: (data) => build({
    heroIcon: ICONS.assignment,
    subject: `New assignment: ${data.title}`,
    preheader: `${data.title} is due ${formatDateTime(data.dueDate, data.timezone)}.`,
    heading: 'A new assignment is available',
    intro: `Your teacher published a new assignment: <strong>${escapeHtml(data.title)}</strong>.`,
    rows: [['Assignment', data.title], [data.contextType || 'Class', data.contextName], ['Submission deadline', formatDateTime(data.dueDate, data.timezone)]],
    body: data.description,
    actionLabel: 'Open assignment',
    url: data.url,
  }, data),

  lesson_published: (data) => build({
    heroIcon: ICONS.lesson,
    subject: `New lesson: ${data.title}`,
    preheader: `A new lesson is available${data.courseName ? ` in ${data.courseName}` : ''}.`,
    heading: 'A new lesson is available',
    intro: `A new lesson, <strong>${escapeHtml(data.title)}</strong>, has been published${data.courseName ? ` in <strong>${escapeHtml(data.courseName)}</strong>` : ''}.`,
    rows: [['Lesson', data.title], ['Course', data.courseName], ['Class', data.className]],
    body: data.summary,
    actionLabel: 'Open lesson',
    url: data.url,
  }, data),

  material_published: (data) => build({
    heroIcon: ICONS.material,
    subject: `New course material: ${data.lessonTitle}`,
    preheader: `${data.fileNames?.length || 1} new file(s) added to ${data.lessonTitle}.`,
    heading: 'New course material is available',
    intro: `New learning material was added to the lesson <strong>${escapeHtml(data.lessonTitle)}</strong>.`,
    rows: [['Lesson', data.lessonTitle], ['Course', data.courseName], ['New files', (data.fileNames || []).slice(0, 8).join(', ') + ((data.fileNames || []).length > 8 ? ` and ${data.fileNames.length - 8} more` : '')]],
    actionLabel: 'View material',
    url: data.url,
  }, data),

  course_published: (data) => build({
    heroIcon: ICONS.course,
    subject: `New course available: ${data.courseName}`,
    preheader: `${data.courseName} is now available to your class.`,
    heading: 'A new course is available',
    intro: `The course <strong>${escapeHtml(data.courseName)}</strong> is now available to your class.`,
    rows: [['Course', data.courseName], ['Course code', data.courseCode], ['Class', data.className], ['Teacher', data.teacherName]],
    body: data.description,
    actionLabel: 'Open course',
    url: data.url,
  }, data),

  announcement: (data) => build({
    heroIcon: ICONS.announcement,
    subject: `Announcement: ${data.title}`,
    preheader: shorten(data.message, 120),
    heading: data.title,
    intro: 'The university administration published a new announcement.',
    body: data.message,
    actionLabel: 'View announcements',
    url: data.url,
  }, data),

  deadline_reminder_24h: (data) => reminder(data, '24 hours'),
  deadline_reminder_6h: (data) => reminder(data, '6 hours'),
}

function reminder(data, window) {
  const kind = data.kind === 'quiz' ? 'quiz' : 'assignment'
  const action = kind === 'quiz' ? 'complete' : 'submit'
  return build({
    heroIcon: ICONS.reminder,
    subject: `Reminder: ${data.title} is due in ${window}`,
    preheader: `Due ${formatDateTime(data.dueDate, data.timezone)}. You have not ${kind === 'quiz' ? 'completed this quiz' : 'submitted this assignment'} yet.`,
    heading: `Due in about ${window}`,
    intro: `This is a reminder that the ${kind} <strong>${escapeHtml(data.title)}</strong> is due in about ${window}. Our records show you have not ${kind === 'quiz' ? 'completed it' : 'submitted it'} yet.`,
    rows: [[kind === 'quiz' ? 'Quiz' : 'Assignment', data.title], [data.contextType || 'Class', data.contextName], ['Deadline', formatDateTime(data.dueDate, data.timezone)]],
    actionLabel: kind === 'quiz' ? 'Open quiz' : 'Open assignment',
    url: data.url,
    plain: [`Please ${action} it before the deadline.`],
  }, data)
}

export const notificationTemplateNames = Object.keys(templates)

export function renderNotificationEmail(template, data) {
  const render = templates[template]
  if (!render) throw new Error(`Unknown email template: ${template}`)
  return render(data)
}
