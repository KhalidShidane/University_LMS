import { ICONS, escapeHtml, renderEmailLayout } from './layout.js'

export function verifyEmailTemplate({ fullName, verifyUrl, expiresInHours, supportUrl }) {
  const firstName = String(fullName || '').trim().split(/\s+/)[0] || 'there'
  const expiry = `${expiresInHours} hour${expiresInHours === 1 ? '' : 's'}`
  const subject = 'Verify your DARSIVO email address'
  const html = renderEmailLayout({
    preheader: `Confirm your email to activate your DARSIVO student account. The link expires in ${expiry}.`,
    heroIcon: ICONS.verify,
    heading: 'Confirm your email address',
    subheading: 'One quick step to activate your student account',
    bodyHtml: `<p style="margin:0 0 14px">Hello <strong>${escapeHtml(firstName)}</strong>,</p>`
      + '<p style="margin:0 0 14px">Welcome to <strong>DARSIVO</strong>! Your student account has been created. Please confirm that this email address belongs to you so we can activate your account.</p>'
      + '<p style="margin:0">Once verified, you can sign in and access your classes, lessons, assignments, and quizzes.</p>',
    action: { label: 'Verify Email', url: verifyUrl },
    highlight: { icon: ICONS.timer, text: `Expires in ${expiry} · single use` },
    notes: [
      { icon: ICONS.lock, html: '<strong style="color:#334155">Didn\'t create an account?</strong><br>You can safely ignore this email. No account will be activated.' },
      { icon: ICONS.help, html: `<strong style="color:#334155">Need help?</strong><br>If the link has expired, request a new one at <a href="${escapeHtml(supportUrl)}" style="color:#1d4ed8">${escapeHtml(supportUrl)}</a> or contact your university administrator.` },
    ],
  })
  const text = [
    `Hello ${firstName},`,
    '',
    'Welcome to DARSIVO! Your student account has been created.',
    'Confirm your email address to activate your account:',
    '',
    verifyUrl,
    '',
    `This link expires in ${expiry} and can be used once.`,
    '',
    "Didn't create an account? You can safely ignore this email.",
    `Need help? Request a new link at ${supportUrl} or contact your university administrator.`,
    '',
    '— DARSIVO Learning Management System',
  ].join('\n')
  return { subject, html, text }
}
