// Converts stored notes (sanitized ProseMirror/TipTap JSON) into standalone HTML documents
// that open in any browser or in Word, and can be printed to PDF.

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const alignStyle = (attrs) => (attrs?.textAlign && attrs.textAlign !== 'left' ? ` style="text-align:${attrs.textAlign}"` : '')
const safeHref = (href) => (/^(https?:|mailto:)/i.test(String(href || '')) ? String(href) : null)

function textWithMarks(node) {
  let html = escapeHtml(node.text || '')
  for (const mark of node.marks || []) {
    if (mark.type === 'bold') html = `<strong>${html}</strong>`
    else if (mark.type === 'italic') html = `<em>${html}</em>`
    else if (mark.type === 'underline') html = `<u>${html}</u>`
    else if (mark.type === 'strike') html = `<s>${html}</s>`
    else if (mark.type === 'code') html = `<code>${html}</code>`
    else if (mark.type === 'link' && safeHref(mark.attrs?.href)) html = `<a href="${escapeHtml(mark.attrs.href)}">${html}</a>`
  }
  return html
}

function cellAttrs(attrs = {}) {
  return `${attrs.colspan > 1 ? ` colspan="${attrs.colspan}"` : ''}${attrs.rowspan > 1 ? ` rowspan="${attrs.rowspan}"` : ''}`
}

export function noteNodeToHtml(node) {
  if (!node || typeof node !== 'object') return ''
  const inner = () => (node.content || []).map(noteNodeToHtml).join('')
  switch (node.type) {
    case 'doc': return inner()
    case 'text': return textWithMarks(node)
    case 'paragraph': return `<p${alignStyle(node.attrs)}>${inner() || '&nbsp;'}</p>`
    case 'heading': { const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2)); return `<h${level}${alignStyle(node.attrs)}>${inner()}</h${level}>` }
    case 'bulletList': return `<ul>${inner()}</ul>`
    case 'orderedList': return `<ol${node.attrs?.start > 1 ? ` start="${node.attrs.start}"` : ''}>${inner()}</ol>`
    case 'listItem': return `<li>${inner()}</li>`
    case 'blockquote': return `<blockquote>${inner()}</blockquote>`
    case 'codeBlock': return `<pre><code>${(node.content || []).map((child) => escapeHtml(child.text || '')).join('')}</code></pre>`
    case 'horizontalRule': return '<hr>'
    case 'hardBreak': return '<br>'
    case 'inlineMath': return `<span class="math" title="LaTeX">\\(${escapeHtml(node.attrs?.latex || '')}\\)</span>`
    case 'blockMath': return `<div class="math math-block" title="LaTeX">\\[${escapeHtml(node.attrs?.latex || '')}\\]</div>`
    case 'table': return `<table>${inner()}</table>`
    case 'tableRow': return `<tr>${inner()}</tr>`
    case 'tableHeader': return `<th${cellAttrs(node.attrs)}>${inner()}</th>`
    case 'tableCell': return `<td${cellAttrs(node.attrs)}>${inner()}</td>`
    default: return inner()
  }
}

/** A complete, printable HTML document for one note. */
export function noteToHtmlDocument(note) {
  const title = note.title?.trim() || 'Untitled note'
  const context = [note.course?.name && `Course: ${note.course.name}${note.course.courseCode ? ` (${note.course.courseCode})` : ''}`, note.lesson?.title && `Lesson: ${note.lesson.title}`].filter(Boolean)
  const updated = note.updatedAt ? new Date(note.updatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ''
  const body = note.content ? noteNodeToHtml(note.content) : `<p>${escapeHtml(note.contentText || '')}</p>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
  body { max-width: 780px; margin: 40px auto; padding: 0 20px; font: 15px/1.7 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
  header { margin-bottom: 28px; padding-bottom: 16px; border-bottom: 2px solid #2563eb; }
  header small { display: block; color: #2563eb; font-weight: 700; letter-spacing: 2px; font-size: 11px; }
  header h1 { margin: 6px 0 8px; font-size: 26px; color: #0f172a; }
  header p { margin: 0; color: #64748b; font-size: 13px; }
  h1, h2, h3, h4 { color: #0f172a; line-height: 1.3; }
  blockquote { margin: 16px 0; padding: 8px 16px; border-left: 4px solid #93c5fd; background: #f8fafc; color: #334155; }
  pre { padding: 14px; overflow-x: auto; border-radius: 8px; background: #0f172a; color: #e2e8f0; font-size: 13px; }
  code { font-family: Consolas, Menlo, monospace; }
  p code, li code { padding: 1px 5px; border-radius: 4px; background: #f1f5f9; }
  table { width: 100%; margin: 16px 0; border-collapse: collapse; }
  th, td { padding: 8px 10px; border: 1px solid #cbd5e1; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; }
  a { color: #1d4ed8; }
  .math { font-family: 'Cambria Math', 'Times New Roman', serif; color: #0f172a; background: #f8fafc; padding: 0 4px; border-radius: 4px; }
  .math-block { display: block; margin: 12px 0; padding: 10px 14px; text-align: center; }
  footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; }
  @media print { body { margin: 0; } a { color: inherit; } }
</style></head>
<body>
<header><small>DARSIVO · MY NOTES</small><h1>${escapeHtml(title)}</h1>${context.length ? `<p>${context.map(escapeHtml).join(' &middot; ')}</p>` : ''}</header>
<main>${body}</main>
<footer>Exported from DARSIVO${updated ? ` · Last updated ${escapeHtml(updated)}` : ''}</footer>
</body></html>`
}

/** Safe file/folder name for downloads and ZIP entries. */
export function safeFileName(value, fallback = 'file', max = 80) {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, max)
    .trim()
  return cleaned || fallback
}

/** Returns a name unique within `used` (a Set), adding " (2)", " (3)"… before the extension. */
export function uniqueName(name, used) {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  let candidate = name
  for (let index = 2; used.has(candidate.toLowerCase()); index += 1) candidate = `${stem} (${index})${extension}`
  used.add(candidate.toLowerCase())
  return candidate
}
