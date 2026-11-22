// Validates and normalises rich-text note documents (TipTap / ProseMirror JSON).
// Only the node types, marks and attributes the notes editor produces are kept, so stored
// content can never carry scripts, unknown attributes or unsafe links.

export const MAX_NOTE_CONTENT_BYTES = 1_500_000
const MAX_DEPTH = 60
const MAX_NODES = 250_000
const MAX_TEXT_INDEX = 500_000

const alignments = new Set(['left', 'center', 'right', 'justify'])
const blockTypes = new Set(['blockMath', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader'])

function contentError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

const intInRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

function textAlign(attrs) {
  return alignments.has(attrs?.textAlign) ? attrs.textAlign : null
}

function cellAttrs(attrs = {}) {
  const colspan = intInRange(attrs.colspan, 1, 50) ? attrs.colspan : 1
  const rowspan = intInRange(attrs.rowspan, 1, 50) ? attrs.rowspan : 1
  const colwidth = Array.isArray(attrs.colwidth) && attrs.colwidth.length <= 50 && attrs.colwidth.every((width) => intInRange(width, 1, 5000)) ? attrs.colwidth : null
  return { colspan, rowspan, colwidth }
}

const nodeAttributes = {
  doc: () => undefined,
  text: () => undefined,
  paragraph: (attrs) => ({ textAlign: textAlign(attrs) }),
  heading: (attrs) => ({ level: intInRange(attrs?.level, 1, 6) ? attrs.level : 2, textAlign: textAlign(attrs) }),
  bulletList: () => undefined,
  orderedList: (attrs) => ({ start: intInRange(attrs?.start, 1, 100000) ? attrs.start : 1 }),
  listItem: () => undefined,
  blockquote: () => undefined,
  codeBlock: (attrs) => ({ language: typeof attrs?.language === 'string' && /^[a-z0-9+#._-]{1,30}$/i.test(attrs.language) ? attrs.language : null }),
  horizontalRule: () => undefined,
  hardBreak: () => undefined,
  table: () => undefined,
  tableRow: () => undefined,
  tableCell: cellAttrs,
  tableHeader: cellAttrs,
  // Math formulas (TipTap v3 mathematics): only the LaTeX source is stored.
  inlineMath: (attrs) => ({ latex: mathLatex(attrs) }),
  blockMath: (attrs) => ({ latex: mathLatex(attrs) }),
}

function mathLatex(attrs) {
  return typeof attrs?.latex === 'string' ? attrs.latex.slice(0, 2000) : ''
}

function safeHref(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) return null
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch { return null }
}

function cleanMarks(marks) {
  if (!Array.isArray(marks)) return undefined
  const seen = new Set()
  const result = []
  for (const mark of marks.slice(0, 10)) {
    const type = mark?.type
    if (seen.has(type)) continue
    if (['bold', 'italic', 'underline', 'strike', 'code'].includes(type)) { seen.add(type); result.push({ type }) }
    else if (type === 'link') {
      const href = safeHref(mark.attrs?.href)
      if (!href) continue
      seen.add(type)
      result.push({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null } })
    }
  }
  return result.length ? result : undefined
}

export function sanitizeNoteContent(raw) {
  if (raw === undefined || raw === null) return { content: { type: 'doc', content: [{ type: 'paragraph' }] }, text: '', wordCount: 0 }
  if (typeof raw !== 'object' || Array.isArray(raw) || raw.type !== 'doc') throw contentError('Note content must be a rich-text document')
  let size
  try { size = Buffer.byteLength(JSON.stringify(raw), 'utf8') } catch { throw contentError('Note content could not be read') }
  if (size > MAX_NOTE_CONTENT_BYTES) throw contentError('This note is too large. Split it into several notes (about 1.5 MB per note).')

  let nodes = 0
  const textParts = []
  const pushText = (value) => { textParts.push(value) }

  function walk(node, depth) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null
    nodes += 1
    if (nodes > MAX_NODES) throw contentError('This note has too many elements to save')
    if (depth > MAX_DEPTH) throw contentError('This note is nested too deeply to save')
    const type = node.type
    const describeAttrs = nodeAttributes[type]
    if (!describeAttrs) return null
    if (type === 'text') {
      if (typeof node.text !== 'string' || !node.text.length) return null
      pushText(node.text)
      const marks = cleanMarks(node.marks)
      return marks ? { type, text: node.text, marks } : { type, text: node.text }
    }
    if (type === 'hardBreak') { pushText('\n'); return { type } }
    if (type === 'inlineMath' || type === 'blockMath') {
      const latex = mathLatex(node.attrs)
      if (!latex.trim()) return null
      pushText(type === 'blockMath' ? `\n${latex}\n` : latex)
      return { type, attrs: { latex } }
    }
    const result = { type }
    const attrs = describeAttrs(node.attrs)
    if (attrs) result.attrs = attrs
    if (Array.isArray(node.content)) {
      const children = node.content.map((child) => walk(child, depth + 1)).filter(Boolean)
      if (children.length) result.content = children
    }
    if (blockTypes.has(type)) pushText('\n')
    return result
  }

  const content = walk(raw, 0)
  if (!content.content?.length) content.content = [{ type: 'paragraph' }]
  const fullText = textParts.join('').replace(/\n{3,}/g, '\n\n').trim()
  const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0
  // Only the searchable copy is capped; the document itself is stored in full.
  return { content, text: fullText.slice(0, MAX_TEXT_INDEX), wordCount }
}
