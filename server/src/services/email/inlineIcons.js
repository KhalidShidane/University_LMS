// Inline (CID) icon images for emails. The PNGs in ./assets/icons are Lucide icons (ISC licence)
// rendered once from the app's lucide-react package. Templates reference them as
// "cid:darsivo-<name>" and sendEmail() attaches exactly the icons a message uses, so emails
// never depend on an external image host.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICON_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'icons')
const CID_PREFIX = 'darsivo-'
const CID_PATTERN = /cid:darsivo-([a-z0-9-]+)/g
const cache = new Map()

export const iconSrc = (name) => `cid:${CID_PREFIX}${name}`

function iconBytes(name) {
  if (!cache.has(name)) cache.set(name, readFileSync(join(ICON_DIR, `${name}.png`)))
  return cache.get(name)
}

/** Inline attachments for every icon referenced in the HTML (unknown names are skipped). */
export function inlineIconAttachments(html) {
  const names = [...new Set([...String(html || '').matchAll(CID_PATTERN)].map((match) => match[1]))]
  return names.flatMap((name) => {
    try {
      return [{ filename: `${name}.png`, content: iconBytes(name).toString('base64'), contentType: 'image/png', contentId: `${CID_PREFIX}${name}` }]
    } catch {
      return []
    }
  })
}

/** For browser previews: replace cid: references with data URIs. */
export function withDataUriIcons(html) {
  return String(html).replace(CID_PATTERN, (match, name) => {
    try { return `data:image/png;base64,${iconBytes(name).toString('base64')}` } catch { return match }
  })
}
