/**
 * Hands a blob to the browser as a download.
 *
 * Its own module so a screen test can replace it with a spy: jsdom implements
 * neither `URL.createObjectURL` nor a real click-to-download, so a test that
 * went through it would be asserting on stubs of the browser rather than on
 * the screen.
 *
 * The anchor is created and removed rather than rendered: React would have to
 * keep an element whose only purpose is to be clicked once.
 */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next tick, not straight away: a browser that has not yet
  // started reading the URL would cancel the download.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
