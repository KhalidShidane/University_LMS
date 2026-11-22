const TARGET_BYTES = 1024 * 1024
const MAX_EDGE = 1600

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')) }
    image.src = url
  })
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function compressImage(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image')
  const image = await loadImage(file)
  const ratio = Math.min(1, MAX_EDGE / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * ratio))
  canvas.height = Math.max(1, Math.round(image.height * ratio))
  canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, canvas.width, canvas.height)
  let result
  for (const quality of [0.84, 0.74, 0.64, 0.54, 0.44]) {
    result = await toBlob(canvas, quality)
    if (result && result.size <= TARGET_BYTES) break
  }
  if (!result || result.size > TARGET_BYTES) throw new Error('This image cannot be reduced below 1 MB. Choose a smaller image.')
  return new File([result], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}
