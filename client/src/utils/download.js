/** Saves an axios blob response, using the server's Content-Disposition filename when present. */
export function saveBlob(response, fallbackName = 'download') {
  const disposition = response.headers?.['content-disposition'] || ''
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
  const name = match ? decodeURIComponent(match[1] || match[2]) : fallbackName
  const url = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
