import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_NOTE_CONTENT_BYTES, sanitizeNoteContent } from './noteContent.service.js'

test('keeps supported rich-text structure and extracts searchable text', () => {
  const { content, text, wordCount } = sanitizeNoteContent({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Cell biology' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Mitochondria', marks: [{ type: 'bold' }, { type: 'underline' }] }, { type: 'text', text: ' produce ATP.' }] },
      { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'print(1)' }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Term' }] }] }] }] },
    ],
  })
  assert.equal(content.content[0].attrs.level, 2)
  assert.equal(content.content[0].attrs.textAlign, 'center')
  assert.deepEqual(content.content[1].content[0].marks, [{ type: 'bold' }, { type: 'underline' }])
  assert.equal(content.content[2].attrs.language, 'python')
  assert.equal(content.content[3].content[0].content[0].type, 'tableHeader')
  assert.match(text, /Cell biology/)
  assert.match(text, /Mitochondria produce ATP\./)
  assert.ok(wordCount >= 6)
})

test('drops unknown nodes, unknown attributes and unsafe links', () => {
  const { content } = sanitizeNoteContent({
    type: 'doc',
    content: [
      { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
      { type: 'paragraph', attrs: { onclick: 'x()', textAlign: 'evil' }, content: [
        { type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
        { type: 'text', text: 'good', marks: [{ type: 'link', attrs: { href: 'https://example.edu/a', onclick: 'x' } }] },
      ] },
    ],
  })
  assert.equal(content.content.length, 1)
  assert.deepEqual(content.content[0].attrs, { textAlign: null })
  assert.equal(content.content[0].content[0].marks, undefined)
  assert.equal(content.content[0].content[1].marks[0].attrs.href, 'https://example.edu/a')
  assert.equal(content.content[0].content[1].marks[0].attrs.onclick, undefined)
})

test('accepts long documents and rejects oversized or malformed content', () => {
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'word '.repeat(200) }] }
  const long = sanitizeNoteContent({ type: 'doc', content: Array.from({ length: 1000 }, () => paragraph) })
  assert.equal(long.wordCount, 200_000)
  assert.throws(() => sanitizeNoteContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(MAX_NOTE_CONTENT_BYTES) }] }] }), /too large/)
  assert.throws(() => sanitizeNoteContent('hello'), /rich-text document/)
  assert.throws(() => sanitizeNoteContent({ type: 'paragraph' }), /rich-text document/)
  assert.deepEqual(sanitizeNoteContent({ type: 'doc', content: [] }).content, { type: 'doc', content: [{ type: 'paragraph' }] })
})
