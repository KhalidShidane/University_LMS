// Background email queue: Academic event -> enqueueEmails() -> EmailJob (MongoDB) -> worker -> sendEmail() -> provider.
// The worker runs inside the API process (like the existing deadline job), survives restarts because
// jobs are durable, respects the provider's daily/monthly quota, and retries temporary failures.
import EmailJob from '../../models/EmailJob.js'
import EmailLog from '../../models/EmailLog.js'
import User from '../../models/User.js'
import { activeTransport, sendEmail } from './email.service.js'
import { renderNotificationEmail } from './templates/notifications.templates.js'
import { isProviderBlocked } from './providerStatus.service.js'

const MINUTE = 60 * 1000
const RETRY_DELAYS_MS = [1, 5, 15, 60, 180].map((minutes) => minutes * MINUTE)
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1
const LOCK_MS = 2 * MINUTE

const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback)
export const queueSettings = () => ({
  dailyLimit: positive(process.env.EMAIL_DAILY_LIMIT, 100),
  monthlyLimit: positive(process.env.EMAIL_MONTHLY_LIMIT, 3000),
  // Daily sends kept free for mandatory account emails (verification).
  reservedForAccountEmails: positive(process.env.EMAIL_DAILY_RESERVED_FOR_ACCOUNT, 20),
  maxPerMinute: Math.max(1, positive(process.env.EMAIL_MAX_PER_MINUTE, 30)),
  intervalMs: Math.max(1000, positive(process.env.EMAIL_QUEUE_INTERVAL_MS, 15000)),
  jobMaxAgeHours: Math.max(1, positive(process.env.EMAIL_JOB_MAX_AGE_HOURS, 72)),
})

/**
 * Idempotently enqueue emails. Each job: { template, category, priority, recipient: {_id,email,fullName}, dedupeKey, data, check?, expiresAt? }.
 * Returns the number of newly queued jobs. Never throws.
 */
export async function enqueueEmails(jobs, now = new Date()) {
  if (!jobs.length) return 0
  const { jobMaxAgeHours } = queueSettings()
  try {
    const result = await EmailJob.bulkWrite(jobs.map((job) => ({
      updateOne: {
        filter: { dedupeKey: job.dedupeKey },
        update: {
          $setOnInsert: {
            template: job.template,
            category: job.category || null,
            priority: job.priority ?? 5,
            recipientUser: job.recipient._id,
            recipientEmail: job.recipient.email,
            recipientName: job.recipient.fullName || '',
            dedupeKey: job.dedupeKey,
            data: job.data || {},
            ...(job.check ? { check: job.check } : {}),
            status: 'pending',
            attempts: 0,
            nextAttemptAt: job.notBefore || now,
            expiresAt: job.expiresAt || new Date(now.getTime() + jobMaxAgeHours * 60 * MINUTE),
          },
        },
        upsert: true,
      },
    })), { ordered: false })
    return result.upsertedCount || 0
  } catch (error) {
    // Duplicate-key races are expected under concurrency; anything else is logged, never thrown.
    if (error?.code !== 11000 && !error?.writeErrors?.every?.((item) => item.code === 11000)) console.error('Email enqueue failed', error.message)
    return error?.result?.upsertedCount || error?.result?.nUpserted || 0
  }
}

export async function remainingQuota(now = new Date()) {
  const { dailyLimit, monthlyLimit, reservedForAccountEmails } = queueSettings()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [sentToday, sentThisMonth] = await Promise.all([
    EmailLog.countDocuments({ status: 'sent', createdAt: { $gte: dayStart } }),
    EmailLog.countDocuments({ status: 'sent', createdAt: { $gte: monthStart } }),
  ])
  return {
    sentToday,
    sentThisMonth,
    available: Math.max(0, Math.min(dailyLimit - reservedForAccountEmails - sentToday, monthlyLimit - reservedForAccountEmails - sentThisMonth)),
  }
}

// Registered send-time validators (e.g. deadline reminders). Return a cancel reason or null.
const checks = new Map()
export function registerEmailCheck(kind, fn) { checks.set(kind, fn) }

async function settle(job, update) {
  await EmailJob.updateOne({ _id: job._id, status: 'sending' }, { $set: { lockedUntil: null, ...update } })
}

async function deliver(job, now) {
  if (job.expiresAt && job.expiresAt <= now) return settle(job, { status: 'expired' })
  const recipient = await User.findById(job.recipientUser).select('email fullName role isActive emailVerified notificationPreferences').lean()
  if (!recipient || !recipient.isActive || recipient.emailVerified === false) return settle(job, { status: 'cancelled', cancelReason: 'recipient_unavailable' })
  if (job.category && recipient.notificationPreferences?.email?.[job.category] === false) return settle(job, { status: 'cancelled', cancelReason: 'preference_disabled' })
  if (job.check?.kind && checks.has(job.check.kind)) {
    const reason = await checks.get(job.check.kind)(job, now)
    if (reason) return settle(job, { status: 'cancelled', cancelReason: reason })
  }

  let message
  try {
    message = renderNotificationEmail(job.template, { ...job.data, recipientName: recipient.fullName })
  } catch (error) {
    console.error(`Email template failed (${job.template})`, error.message)
    return settle(job, { status: 'failed', lastErrorCode: 'template_error' })
  }
  // Always send to the current registered address.
  const result = await sendEmail({ type: job.template, to: { email: recipient.email, name: recipient.fullName, userId: recipient._id }, customId: `job-${job._id}`, ...message })
  if (result.blocked) {
    // Provider blocked the account: keep the job waiting, untouched, and do not count the attempt.
    await EmailJob.updateOne({ _id: job._id, status: 'sending' }, { $set: { status: 'pending', lockedUntil: null, lastErrorCode: 'provider_blocked', nextAttemptAt: now }, $inc: { attempts: -1 } })
    return 'blocked'
  }
  if (result.ok) return settle(job, { status: 'sent', sentAt: new Date(), providerMessageId: result.providerMessageId, lastErrorCode: '' })
  if (result.permanent || job.attempts >= MAX_ATTEMPTS) return settle(job, { status: 'failed', lastErrorCode: result.errorCode })
  const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)]
  return settle(job, { status: 'pending', lastErrorCode: result.errorCode, nextAttemptAt: new Date(Date.now() + delay) })
}

let quotaNoticeDay = ''
/** Processes one batch. Returns { sent, processed, waiting, quotaExhausted }. */
export async function processEmailQueueOnce(now = new Date()) {
  const { maxPerMinute, intervalMs } = queueSettings()
  // Recover jobs left in "sending" by a crash or restart.
  await EmailJob.updateMany({ status: 'sending', lockedUntil: { $lt: now } }, { $set: { status: 'pending', lockedUntil: null } })
  // Provider blocked: pause completely (no sends, no retries, no expiry) until an admin resumes.
  if (await isProviderBlocked(activeTransport().name)) {
    return { sent: 0, processed: 0, waiting: await EmailJob.countDocuments({ status: 'pending' }), quotaExhausted: false, paused: true }
  }
  // Expire anything too old to be useful.
  await EmailJob.updateMany({ status: 'pending', expiresAt: { $lte: now } }, { $set: { status: 'expired' } })

  const quota = await remainingQuota(now)
  const batchSize = Math.min(quota.available, Math.max(1, Math.floor(maxPerMinute * (intervalMs / MINUTE))))
  const waiting = await EmailJob.countDocuments({ status: 'pending', nextAttemptAt: { $lte: now } })
  if (!quota.available) {
    const day = now.toISOString().slice(0, 10)
    if (waiting && quotaNoticeDay !== day) {
      quotaNoticeDay = day
      console.warn(`Email quota reached (${quota.sentToday} sent today, ${quota.sentThisMonth} this month); ${waiting} notification email(s) will wait for the next quota window`)
    }
    return { sent: 0, processed: 0, waiting, quotaExhausted: true }
  }

  let processed = 0
  let sent = 0
  for (; processed < batchSize; processed += 1) {
    const job = await EmailJob.findOneAndUpdate(
      { status: 'pending', nextAttemptAt: { $lte: now } },
      { $set: { status: 'sending', lockedUntil: new Date(Date.now() + LOCK_MS) }, $inc: { attempts: 1 } },
      { sort: { priority: 1, nextAttemptAt: 1 }, new: true },
    ).lean()
    if (!job) break
    let outcome
    try {
      outcome = await deliver(job, now)
    } catch (error) {
      console.error('Email job processing failed', error.message)
      await settle(job, { status: 'pending', lastErrorCode: 'worker_error', nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_MS[0]) })
    }
    if (outcome === 'blocked') return { sent, processed, waiting: await EmailJob.countDocuments({ status: 'pending' }), quotaExhausted: false, paused: true }
    if ((await EmailJob.findById(job._id).select('status').lean())?.status === 'sent') sent += 1
  }
  return { sent, processed, waiting: Math.max(0, waiting - processed), quotaExhausted: false }
}

/**
 * After a provider block is lifted: give waiting notifications back the time they lost while paused
 * (deadline reminders keep their deadline-based expiry) and process the queue right away.
 * Jobs are claimed atomically and finished jobs are never re-sent, so resuming cannot duplicate emails.
 */
export async function resumeEmailQueue({ pausedSince, now = new Date() } = {}) {
  const pausedMs = pausedSince ? Math.max(0, now - new Date(pausedSince)) : 0
  let extended = 0
  if (pausedMs) {
    const result = await EmailJob.updateMany(
      { status: 'pending', 'check.kind': { $exists: false } },
      [{ $set: { expiresAt: { $add: ['$expiresAt', pausedMs] }, nextAttemptAt: now } }],
    )
    extended = result.modifiedCount
  }
  await EmailJob.updateMany({ status: 'pending', nextAttemptAt: { $gt: now } , lastErrorCode: 'provider_blocked' }, { $set: { nextAttemptAt: now } })
  const pending = await EmailJob.countDocuments({ status: 'pending' })
  setImmediate(() => { processEmailQueueOnce().catch((error) => console.error('Email queue run failed', error.message)) })
  return { pending, extended }
}

export function startEmailQueueWorker() {
  const { intervalMs } = queueSettings()
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try { await processEmailQueueOnce() } catch (error) { console.error('Email queue run failed', error.message) } finally { running = false }
  }
  void run()
  const interval = setInterval(run, intervalMs)
  interval.unref?.()
  return () => clearInterval(interval)
}
