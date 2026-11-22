// Account security emails: password reset link, password changed notice, 2FA notices.
import { ICONS, escapeHtml, renderEmailLayout } from './layout.js'

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there'
const when = (date, timezone = 'UTC') => {
  try { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone, timeZoneName: 'short' }).format(date) } catch { return date.toISOString() }
}

export function passwordResetTemplate({ fullName, resetUrl, expiresInMinutes, supportUrl }) {
  const name = firstName(fullName)
  const subject = 'Reset your DARSIVO password'
  const html = renderEmailLayout({
    preheader: `Use this link within ${expiresInMinutes} minutes to choose a new password.`,
    heroIcon: ICONS.reset,
    heading: 'Reset your password',
    subheading: 'We received a request to reset the password for your account',
    bodyHtml: `<p style="margin:0 0 14px">Hello <strong>${escapeHtml(name)}</strong>,</p>`
      + '<p style="margin:0">Click the button below to choose a new password. For your security, signing in with the new password will sign you out of all other devices.</p>',
    action: { label: 'Choose a new password', url: resetUrl },
    highlight: { icon: ICONS.timer, text: `Expires in ${expiresInMinutes} minutes · single use` },
    notes: [
      { icon: ICONS.lock, html: '<strong style="color:#334155">Didn\'t ask for this?</strong><br>Ignore this email. Your password stays the same and no one can change it without this link.' },
      { icon: ICONS.help, html: `<strong style="color:#334155">Link expired?</strong><br>Request a new one at <a href="${escapeHtml(supportUrl)}" style="color:#1d4ed8">${escapeHtml(supportUrl)}</a>.` },
    ],
  })
  const text = [`Hello ${name},`, '', 'We received a request to reset your DARSIVO password. Choose a new password here:', '', resetUrl, '', `This link expires in ${expiresInMinutes} minutes and can be used once.`, "If you didn't ask for this, ignore this email; your password stays the same.", '', '— DARSIVO Learning Management System'].join('\n')
  return { subject, html, text }
}

export function passwordChangedTemplate({ fullName, changedAt = new Date(), timezone, loginUrl, forgotUrl }) {
  const name = firstName(fullName)
  const subject = 'Your DARSIVO password was changed'
  const html = renderEmailLayout({
    preheader: 'Your password was just changed. If this was not you, reset it now.',
    heroIcon: ICONS.shield,
    heading: 'Your password was changed',
    bodyHtml: `<p style="margin:0 0 14px">Hello <strong>${escapeHtml(name)}</strong>,</p>`
      + `<p style="margin:0 0 14px">The password for your DARSIVO account was changed on <strong>${escapeHtml(when(changedAt, timezone))}</strong>. All other sessions were signed out.</p>`
      + '<p style="margin:0">If you made this change, no further action is needed.</p>',
    action: { label: 'Sign in', url: loginUrl },
    notes: [
      { icon: ICONS.alert, html: `<strong style="color:#334155">Wasn't you?</strong><br>Reset your password immediately at <a href="${escapeHtml(forgotUrl)}" style="color:#1d4ed8">${escapeHtml(forgotUrl)}</a> and contact your university administrator.` },
    ],
  })
  const text = [`Hello ${name},`, '', `The password for your DARSIVO account was changed on ${when(changedAt, timezone)}. All other sessions were signed out.`, '', `Wasn't you? Reset your password now: ${forgotUrl}`, '', '— DARSIVO Learning Management System'].join('\n')
  return { subject, html, text }
}

export function twoFactorChangedTemplate({ fullName, enabled, changedAt = new Date(), timezone, forgotUrl }) {
  const name = firstName(fullName)
  const subject = enabled ? 'Two-step verification is on for your DARSIVO account' : 'Two-step verification was turned off for your DARSIVO account'
  const html = renderEmailLayout({
    preheader: enabled ? 'Your account now needs an authenticator code to sign in.' : 'Your account no longer needs an authenticator code to sign in.',
    heroIcon: enabled ? ICONS.shield : ICONS.lockKeyhole,
    heading: enabled ? 'Two-step verification is on' : 'Two-step verification was turned off',
    bodyHtml: `<p style="margin:0 0 14px">Hello <strong>${escapeHtml(name)}</strong>,</p>`
      + `<p style="margin:0">${enabled ? 'From now on, signing in to your account needs your password and a 6-digit code from your authenticator app.' : 'Your account now signs in with a password only.'} This change was made on <strong>${escapeHtml(when(changedAt, timezone))}</strong>.</p>`,
    notes: [{ icon: ICONS.alert, html: `<strong style="color:#334155">Wasn't you?</strong><br>Reset your password at <a href="${escapeHtml(forgotUrl)}" style="color:#1d4ed8">${escapeHtml(forgotUrl)}</a> and contact your administrator.` }],
  })
  const text = [`Hello ${name},`, '', `${subject}. Changed on ${when(changedAt, timezone)}.`, `Wasn't you? Reset your password: ${forgotUrl}`].join('\n')
  return { subject, html, text }
}
