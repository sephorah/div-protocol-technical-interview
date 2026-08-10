import { API_PREFIX, apiErrorFor, networkError } from './client'

const FULL = 100

/**
 * A multipart POST that reports how much of the body has left the browser.
 *
 * XMLHttpRequest and not fetch, which is the rest of this layer's transport:
 * fetch has no upload progress event, and streaming a request body needs
 * `duplex: 'half'` plus an HTTP/2 origin that no browser ships uniformly. What
 * the progress buys is not decoration -- it is the moment the last byte is sent
 * while the server is still checking the magic bytes, which is precisely when
 * the screen must say "verification" rather than "termine".
 *
 * Cookies ride along without `withCredentials`: the call is same-origin, the
 * portal being served from one nginx.
 */
export const postWithProgress = <T>(
  path: string,
  body: FormData,
  onProgress: (percent: number) => void,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `${API_PREFIX}${path}`)
    request.setRequestHeader('accept', 'application/json')

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || event.total === 0) return
      onProgress(Math.min(FULL, Math.round((event.loaded / event.total) * FULL)))
    })

    // A small file can be sent in one chunk and never fire a 100 % progress
    // event, which would leave the row saying "envoi en cours" until the
    // answer lands. This event fires once the body is out, always.
    request.upload.addEventListener('load', () => {
      onProgress(FULL)
    })

    request.addEventListener('load', () => {
      const contentType = request.getResponseHeader('content-type') ?? ''
      if (request.status >= 200 && request.status < 300) {
        try {
          resolve(JSON.parse(request.responseText) as T)
        } catch {
          // A 2xx that is not JSON is the prefix drift nginx answers with the
          // SPA's own index.html -- the same case api/client.ts guards. Built
          // through apiErrorFor so the wording has one source.
          reject(apiErrorFor(404, '', ''))
        }
        return
      }
      reject(apiErrorFor(request.status, contentType, request.responseText))
    })

    // Both are the same event for the person waiting: nothing arrived.
    request.addEventListener('error', () => {
      reject(networkError())
    })
    request.addEventListener('abort', () => {
      reject(networkError())
    })

    request.send(body)
  })
