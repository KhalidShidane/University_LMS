// Mirrors server/src/services/codeGenerator.service.js so the form shows the same code the server will create.
const STOP_WORDS = new Set(['and', 'of', 'the', 'for', 'in', 'on', 'to', 'a', 'an', '&', 'iyo', 'ee', 'ka', 'ku'])

export function suggestCode(name, { maxLength = 16, numbered = false } = {}) {
  const words = String(name || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return ''
  const meaningful = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()))
  const source = meaningful.length ? meaningful : words
  const base = (source.length === 1
    ? source[0].slice(0, 4)
    : source.map((word) => (/^[A-Z0-9]{2,4}$/.test(word) ? word : word[0])).join('')
  ).toUpperCase().slice(0, maxLength)
  return numbered ? `${base}101` : base
}
