import JSZip from 'jszip'

const xmlEscape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const xmlUnescape = (value) => String(value ?? '').replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16))).replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&')
const columnIndex = (letters) => [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
const cellText = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1])).join('')

export async function parseExcelRows(buffer) {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true })
  const sheetFile = zip.file('xl/worksheets/sheet1.xml')
  if (!sheetFile) throw Object.assign(new Error('Excel workbook must contain a first worksheet'), { status: 400 })
  const sharedFile = zip.file('xl/sharedStrings.xml')
  const sharedStrings = sharedFile ? [...(await sharedFile.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => cellText(match[1])) : []
  const xml = await sheetFile.async('string')
  const rows = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((match) => {
    const cells = []
    for (const cell of match[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = cell[1].match(/\br="([A-Z]+)\d+"/i)?.[1]
      if (!ref) continue
      const value = cell[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1]
      cells[columnIndex(ref)] = type === 's' ? (sharedStrings[Number(value)] || '') : type === 'inlineStr' ? cellText(cell[2]) : xmlUnescape(value || '')
    }
    return cells
  }).filter((row) => row.some((cell) => String(cell || '').trim()))
  if (rows.length < 2) return []
  const headers = rows.shift().map((value) => String(value || '').trim().replace(/\s+/g, '').toLowerCase())
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()])))
}

export async function createExcelTemplate(headers, sheetName) {
  const zip = new JSZip()
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlEscape(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'
  const cells = headers.map((header, index) => {
    let number = index + 1; let ref = ''
    while (number) { const remainder = (number - 1) % 26; ref = String.fromCharCode(65 + remainder) + ref; number = Math.floor((number - 1) / 26) }
    return `<c r="${ref}1" t="inlineStr"><is><t>${xmlEscape(header)}</t></is></c>`
  }).join('')
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', workbook)
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells}</row></sheetData></worksheet>`)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
