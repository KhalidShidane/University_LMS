const MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024

function findEndRecord(view) {
  const minOffset = Math.max(0, view.byteLength - 22 - 0xffff)
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  }
  throw new Error('This Office file is not a valid DOCX or PPTX document')
}

async function unzipTextFiles(buffer) {
  const view = new DataView(buffer)
  const endOffset = findEndRecord(view)
  const entryCount = view.getUint16(endOffset + 10, true)
  const directoryOffset = view.getUint32(endOffset + 16, true)
  if (entryCount > 3000) throw new Error('This Office file contains too many parts to preview')
  const files = new Map()
  const decoder = new TextDecoder()
  let totalUncompressedBytes = 0
  let offset = directoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('This Office file has an invalid archive directory')
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength))

    totalUncompressedBytes += /\.(xml|rels)$/i.test(name) ? uncompressedSize : 0
    if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw new Error('This Office file is too large to preview safely')
    if (uncompressedSize > MAX_UNCOMPRESSED_BYTES) throw new Error('This Office file is too large to preview safely')
    if (/\.(xml|rels)$/i.test(name)) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('This Office file contains an invalid document part')
      const localNameLength = view.getUint16(localOffset + 26, true)
      const localExtraLength = view.getUint16(localOffset + 28, true)
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength
      const compressed = new Uint8Array(buffer, dataOffset, compressedSize)
      let contents
      if (method === 0) contents = compressed
      else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
        contents = new Uint8Array(await new Response(stream).arrayBuffer())
      } else throw new Error('This browser cannot read the compression format in this Office file')
      files.set(name, decoder.decode(contents))
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

function xmlDocument(files, name) {
  const source = files.get(name)
  if (!source) return null
  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('This Office file contains invalid text data')
  return document
}

function elementsByName(root, name) {
  return [...root.getElementsByTagName('*')].filter((element) => element.localName === name)
}

function readParagraphs(root) {
  return elementsByName(root, 'p').map((paragraph) => elementsByName(paragraph, 't').map((run) => run.textContent || '').join('')).filter((text) => text.trim())
}

function normalizeArchivePath(path) {
  const parts = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

async function readDocx(files) {
  const document = xmlDocument(files, 'word/document.xml')
  if (!document) throw new Error('The Word document has no readable text content')
  const paragraphs = readParagraphs(document)
  if (!paragraphs.length) throw new Error('The Word document has no readable text content')
  return { format: 'docx', paragraphs }
}

async function readPptx(files) {
  const presentation = xmlDocument(files, 'ppt/presentation.xml')
  const relationships = xmlDocument(files, 'ppt/_rels/presentation.xml.rels')
  const targets = new Map()
  if (relationships) {
    for (const relation of elementsByName(relationships, 'Relationship')) {
      targets.set(relation.getAttribute('Id'), relation.getAttribute('Target'))
    }
  }
  const slideNames = presentation
    ? elementsByName(presentation, 'sldId').map((slide) => slide.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'))
      .map((id) => targets.get(id))
      .filter(Boolean)
      .map((target) => normalizeArchivePath(target.startsWith('/') ? target.slice(1) : `ppt/${target}`))
    : []
  const fallbackSlides = [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1]) - Number(b.match(/slide(\d+)/i)?.[1]))
  const slides = (slideNames.length ? slideNames : fallbackSlides).map((name, index) => {
    const document = xmlDocument(files, name)
    return { number: index + 1, paragraphs: document ? readParagraphs(document) : [] }
  }).filter((slide) => slide.paragraphs.length)
  if (!slides.length) throw new Error('The PowerPoint file has no readable text content')
  return { format: 'pptx', slides }
}

export async function readOfficeText(file) {
  const files = await unzipTextFiles(await file.arrayBuffer())
  if (files.has('word/document.xml')) return readDocx(files)
  if (files.has('ppt/presentation.xml')) return readPptx(files)
  throw new Error('Only DOCX and PPTX files can be read here. Download this file to open it in another app.')
}
