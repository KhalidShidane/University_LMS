// Shared, responsive DARSIVO email layout.
// Table-based with inline styles so it renders consistently in Gmail, Outlook, and mobile apps.
// Icons are real Lucide icons (the same set the app uses), embedded as inline PNG attachments
// (see ../inlineIcons.js), so they always display and need no external image host.
import { iconSrc } from '../inlineIcons.js'

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

// Names of the PNG files in services/email/assets/icons.
export const ICONS = {
  brand: 'brand',
  verify: 'hero-verify',
  quiz: 'hero-quiz',
  assignment: 'hero-assignment',
  lesson: 'hero-lesson',
  material: 'hero-material',
  course: 'hero-course',
  announcement: 'hero-announcement',
  reminder: 'hero-reminder',
  timer: 'timer',
  lock: 'lock',
  help: 'help',
  reset: 'hero-reset',
  shield: 'hero-shield',
  lockKeyhole: 'hero-lock',
  alert: 'alert',
}

const brand = {
  name: 'DARSIVO',
  tagline: 'Learning Management System',
  navy: '#0b1f3a',
  navy2: '#173f73',
  primary: '#2563eb',
  primary2: '#4f46e5',
  primaryDark: '#1d4ed8',
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e5e9f0',
  surface: '#eef2f8',
  soft: '#f8fafc',
}
const font = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
// `name` is an ICONS.* value; it becomes an inline cid: image.
const img = (name, size, alt = '') => `<img src="${escapeHtml(iconSrc(name))}" width="${size}" height="${size}" alt="${escapeHtml(alt)}" style="display:block;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none">`

/** A small icon + text row, used for notices and footnotes. */
function iconRow(iconName, html, { color = brand.body } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="48" valign="top" style="width:48px;padding:2px 0">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="36" height="36" bgcolor="#eaf1ff" style="width:36px;height:36px;border-radius:10px;background:#eaf1ff">${img(iconName, 20)}</td></tr></table>
    </td>
    <td valign="middle" style="padding:2px 0 2px 4px;font-size:13.5px;line-height:1.6;color:${color}">${html}</td>
  </tr></table>`
}

/**
 * @param {{
 *   preheader?: string,
 *   heading: string,
 *   subheading?: string,
 *   bodyHtml: string,
 *   heroIcon?: string,                                   // ICONS.* name shown in a blue circle above the heading
 *   highlight?: { icon?: string, text: string },          // notice under the button (e.g. expiry)
 *   notes?: { icon: string, html: string }[],             // icon + text rows at the bottom of the card
 *   action?: { label: string, url: string },
 *   footnoteHtml?: string,                                // plain text footnote (used when no notes)
 * }} parts
 */
export function renderEmailLayout({ preheader = '', heading, subheading = '', bodyHtml, heroIcon = '', highlight = null, notes = [], action, footnoteHtml = '' }) {
  const centered = Boolean(heroIcon)
  const hero = heroIcon ? `
          <tr><td align="center" style="padding:0 0 18px">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="104" height="104" bgcolor="#eaf1ff" style="width:104px;height:104px;border-radius:52px;background:#eaf1ff">
              <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td align="center" valign="middle" width="80" height="80" bgcolor="${brand.primary}" style="width:80px;height:80px;border-radius:40px;background:${brand.primary};background-image:linear-gradient(135deg,${brand.primary} 0%,${brand.primary2} 100%);box-shadow:0 8px 18px rgba(37,99,235,.30)">
                <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td>${img(heroIcon, 40, '')}</td></tr></table>
              </td></tr></table>
            </td></tr></table>
          </td></tr>` : ''

  const button = action ? `
          <tr><td align="center" style="padding:4px 0 ${highlight ? '18px' : '28px'}">
            <table role="presentation" cellpadding="0" cellspacing="0" class="btn-table"><tr><td align="center" bgcolor="${brand.primary}" style="border-radius:12px;background:${brand.primary};background-image:linear-gradient(135deg,${brand.primary} 0%,${brand.primary2} 100%);box-shadow:0 10px 22px rgba(37,99,235,.30)">
              <a href="${escapeHtml(action.url)}" target="_blank" class="btn" style="display:inline-block;padding:16px 42px;font-family:${font};font-size:16px;font-weight:700;letter-spacing:.3px;color:#ffffff;text-decoration:none;border-radius:12px">${escapeHtml(action.label)}&nbsp;&nbsp;&rarr;</a>
            </td></tr></table>
          </td></tr>` : ''

  const notice = highlight ? `
          <tr><td align="center" style="padding:0 0 26px">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:#fff8ed;border:1px solid #fde1b8;border-radius:999px"><tr>
              <td style="padding:7px 4px 7px 12px">${img(highlight.icon || ICONS.timer, 18)}</td>
              <td style="padding:7px 16px 7px 4px;font-size:13px;font-weight:600;color:#9a3412;white-space:nowrap" class="pill-text">${escapeHtml(highlight.text)}</td>
            </tr></table>
          </td></tr>` : ''

  const noteRows = notes.length ? `
          <tr><td style="padding:24px 0 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${brand.line};padding:20px 0 0">
              ${notes.map((note, index) => `<div style="padding:${index ? '12px' : '0'} 0 0">${iconRow(note.icon, note.html, { color: brand.muted })}</div>`).join('')}
            </td></tr></table>
          </td></tr>` : ''

  const footnote = !notes.length && footnoteHtml ? `
          <tr><td style="padding:24px 0 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${brand.line};padding:18px 0 0;font-size:13px;line-height:1.65;color:${brand.muted}">${footnoteHtml}</td></tr></table>
          </td></tr>` : ''

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
<style>
  @media only screen and (max-width:600px) {
    .wrap { padding:14px 8px !important; }
    .card-pad { padding:30px 20px 26px !important; }
    .head-pad { padding:18px 20px !important; }
    .title { font-size:23px !important; }
    .btn-table { width:100% !important; }
    .btn { display:block !important; padding:16px 18px !important; }
    .pill-text { white-space:normal !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${brand.surface};font-family:${font};color:${brand.ink};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.surface}"><tr><td align="center" class="wrap" style="padding:36px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">

    <!-- Header -->
    <tr><td class="head-pad" bgcolor="${brand.navy}" style="background:${brand.navy};background-image:linear-gradient(135deg,${brand.navy} 0%,${brand.navy2} 100%);border-radius:20px 20px 0 0;padding:20px 32px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle" width="42" style="width:42px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="42" height="42" bgcolor="${brand.primary}" style="width:42px;height:42px;border-radius:11px;background:${brand.primary};background-image:linear-gradient(135deg,#3b82f6 0%,${brand.primary2} 100%)">${img(ICONS.brand, 26, 'DARSIVO')}</td></tr></table>
        </td>
        <td valign="middle" style="padding-left:12px;font-family:${font}">
          <div style="font-size:19px;font-weight:800;letter-spacing:3px;color:#ffffff;line-height:1.2">${brand.name}</div>
          <div style="font-size:11.5px;letter-spacing:.7px;color:#a9bcd8;line-height:1.4">${brand.tagline}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td height="4" style="height:4px;line-height:4px;font-size:0;background:${brand.primary};background-image:linear-gradient(90deg,#38bdf8 0%,${brand.primary} 45%,${brand.primary2} 100%)">&nbsp;</td></tr>

    <!-- Card -->
    <tr><td class="card-pad" bgcolor="#ffffff" style="background:#ffffff;border-radius:0 0 20px 20px;padding:40px 44px 34px;box-shadow:0 14px 34px rgba(15,23,42,.08)">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${hero}
        <tr><td ${centered ? 'align="center" ' : ''}class="title" style="padding:0 0 ${subheading ? '8px' : '18px'};font-size:26px;line-height:1.25;font-weight:800;letter-spacing:-.2px;color:${brand.ink};${centered ? 'text-align:center;' : ''}">${escapeHtml(heading)}</td></tr>
        ${subheading ? `<tr><td ${centered ? 'align="center" ' : ''}style="padding:0 0 22px;font-size:15px;line-height:1.5;color:${brand.muted};${centered ? 'text-align:center;' : ''}">${escapeHtml(subheading)}</td></tr>` : ''}
        <tr><td style="padding:0 0 26px;font-size:15.5px;line-height:1.75;color:${brand.body}">${bodyHtml}</td></tr>
        ${button}${notice}${noteRows}${footnote}
      </table>
    </td></tr>

    <!-- Footer -->
    <tr><td style="padding:24px 12px 0;text-align:center;font-size:12px;line-height:1.75;color:${brand.muted}">
      <strong style="color:${brand.body};letter-spacing:2px">${brand.name}</strong>&nbsp;&middot;&nbsp;${brand.tagline}<br>
      This is an automated message. Please do not reply to this email.<br>
      &copy; ${new Date().getFullYear()} ${brand.name}. All rights reserved.
    </td></tr>

  </table>
</td></tr></table>
</body></html>`
}
