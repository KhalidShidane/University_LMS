import EmailJob from '../models/EmailJob.js'
import { activeTransport, sendEmail } from '../services/email/email.service.js'
import { remainingQuota, resumeEmailQueue } from '../services/email/emailQueue.service.js'
import { effectiveProviderStatus, getProviderStatus, markProviderHealthy } from '../services/email/providerStatus.service.js'
import { renderEmailLayout } from '../services/email/templates/layout.js'

const providerView = (state, provider = activeTransport().name) => ({
  status: effectiveProviderStatus(state, provider),
  since: state.since || null,
  lastErrorCode: state.lastErrorCode || '',
  providerErrorCode: state.providerErrorCode || '',
  providerErrorIdentifier: state.providerErrorIdentifier || '',
  httpStatus: state.httpStatus ?? null,
  lastErrorMessage: state.lastErrorMessage || '',
  lastCheckedAt: state.lastCheckedAt || null,
  resumedAt: state.resumedAt || null,
})

async function queueCounts() {
  const rows = await EmailJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  return Object.fromEntries(['pending', 'sending', 'sent', 'failed', 'cancelled', 'expired'].map((status) => [status, rows.find((row) => row._id === status)?.count || 0]))
}

export async function getEmailStatus(_req, res) {
  const [state, queue, quota] = await Promise.all([getProviderStatus({ fresh: true }), queueCounts(), remainingQuota()])
  return res.json({
    success: true,
    provider: { name: activeTransport().name, senderEmail: process.env.EMAIL_FROM || '', testRecipient: process.env.EMAIL_TEST_RECIPIENT || '', ...providerView(state) },
    queue,
    quota,
  })
}

/**
 * Admin action: verify the provider can send again (one real test email to EMAIL_TEST_RECIPIENT,
 * or the signed-in administrator's address),
 * and only then mark it healthy and resume the paused queue. Nothing resumes if the test fails.
 */
export async function testAndResumeEmail(req, res) {
  const transport = activeTransport()
  const before = await getProviderStatus({ fresh: true })
  const wasBlocked = effectiveProviderStatus(before, transport.name) === 'temporarily_blocked'
  const connection = transport.checkConnection ? await transport.checkConnection() : { ok: true, httpStatus: null }
  if (!connection.ok) {
    return res.json({ success: false, resumed: false, stage: 'credentials', message: connection.errorCode === 'not_configured' ? 'Email provider credentials are not configured on the server.' : 'The provider rejected the API credentials.', connection, provider: providerView(before) })
  }

  const recipient = process.env.EMAIL_TEST_RECIPIENT || req.user.email
  const text = 'This is an automated DARSIVO test email sent by an administrator to confirm that email delivery works. No action is needed.'
  const result = await sendEmail({
    type: 'provider_test',
    to: { email: recipient, name: 'DARSIVO Administrator', userId: req.user._id },
    subject: 'DARSIVO email delivery test',
    html: renderEmailLayout({ heading: 'Email delivery test', bodyHtml: text }),
    text,
    customId: `provider-test-${Date.now()}`,
  }, { bypassProviderBlock: true })

  if (!result.ok) {
    const state = await getProviderStatus({ fresh: true })
    return res.json({
      success: false,
      resumed: false,
      stage: 'send',
      message: result.blocked
        ? 'The provider still reports the account as temporarily blocked. Sending stays paused; contact the provider\'s support with the error reference below.'
        : 'The test email could not be sent. Sending was not resumed.',
      test: { errorCode: result.errorCode, httpStatus: result.httpStatus ?? null, providerErrorCode: result.providerErrorCode || '', providerErrorIdentifier: result.providerErrorIdentifier || '' },
      provider: providerView(state),
    })
  }

  const state = await markProviderHealthy({ resumedBy: req.user._id })
  const resume = wasBlocked
    ? await resumeEmailQueue({ pausedSince: before.since })
    : { pending: await EmailJob.countDocuments({ status: 'pending' }), extended: 0 }
  return res.json({
    success: true,
    resumed: wasBlocked,
    stage: 'done',
    message: wasBlocked
      ? `Test email accepted. Sending resumed; ${resume.pending} waiting email(s) will be delivered within the quota.`
      : 'Test email accepted. Email delivery is working.',
    test: { recipient, providerMessageId: result.providerMessageId },
    queue: resume,
    provider: providerView(state),
  })
}
