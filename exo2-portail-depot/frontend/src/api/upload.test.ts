import { afterEach, describe, expect, it, vi } from 'vitest'
import { postWithProgress } from './upload'

class FakeXhr extends EventTarget {
  static last: FakeXhr | null = null
  upload = new EventTarget()
  status = 0
  responseText = ''
  url = ''

  constructor() {
    super()
    FakeXhr.last = this
  }

  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader() {}
  getResponseHeader() {
    return 'application/json'
  }
  send() {}
}

const stubXhr = () => {
  FakeXhr.last = null
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
}

const current = (): FakeXhr => {
  if (FakeXhr.last === null) throw new Error('no request was opened')
  return FakeXhr.last
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('postWithProgress', () => {
  it('prefixes the path and resolves the parsed answer', async () => {
    stubXhr()
    const pending = postWithProgress('/public/files', new FormData(), () => undefined)

    const request = current()
    expect(request.url).toBe('/api/v1/public/files')
    request.status = 201
    request.responseText = JSON.stringify({ itemId: 'i1' })
    request.dispatchEvent(new Event('load'))

    await expect(pending).resolves.toEqual({ itemId: 'i1' })
  })

  // A small file can be sent in a single chunk and never fire a 100 % progress
  // event, which would leave the row saying "envoi en cours" for ever.
  it('reports 100 % once the body is out, whatever the progress events said', async () => {
    stubXhr()
    const seen: number[] = []
    const pending = postWithProgress('/public/files', new FormData(), (percent) => {
      seen.push(percent)
    })

    const request = current()
    request.upload.dispatchEvent(
      new ProgressEvent('progress', { lengthComputable: true, loaded: 30, total: 100 }),
    )
    request.upload.dispatchEvent(new Event('load'))
    request.status = 201
    request.responseText = '{}'
    request.dispatchEvent(new Event('load'))

    await pending
    expect(seen).toEqual([30, 100])
  })

  it('turns a transport failure into a network error rather than letting it escape', async () => {
    stubXhr()
    const pending = postWithProgress('/public/files', new FormData(), () => undefined)
    current().dispatchEvent(new Event('error'))

    await expect(pending).rejects.toMatchObject({ kind: 'network' })
  })

  // The prefix drift: nginx stops routing /api/ and the SPA's own index.html
  // comes back with 200. Parsed as a receipt, it would tick a piece nobody
  // deposited.
  it('refuses a 2xx that is not JSON', async () => {
    stubXhr()
    const pending = postWithProgress('/public/files', new FormData(), () => undefined)

    const request = current()
    request.status = 200
    request.responseText = '<!doctype html>'
    request.dispatchEvent(new Event('load'))

    await expect(pending).rejects.toMatchObject({ kind: 'notFound' })
  })
})
