import type { SafeHttpClient, SafeHttpRequestInit, SafeHttpResponse } from './types'
import { NormalizedProviderError, SafeHttpError } from './errors'
import { hostMatchesAllowlist } from './url-guard'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_BYTES = 50_000_000 // 50 MB
const MAX_REDIRECTS = 5

// Cancellation closes the reader immediately, but its source acknowledgement may never settle.
function cancelWithoutWaiting(source: { cancel(reason?: unknown): Promise<void> } | null | undefined, reason?: unknown): void {
  try { void source?.cancel(reason).catch(() => {}) }
  catch { /* Keep the original error and still complete cleanup if cancellation throws. */ }
}

export type SafeHttpClientOptions = {
  pluginId: string
  version: string
  allowedHosts: string[]
  fetchImpl?: typeof globalThis.fetch
}

export class DefaultSafeHttpClient implements SafeHttpClient {
  private readonly pluginId: string
  private readonly version: string
  private readonly allowedHosts: string[]
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: SafeHttpClientOptions) {
    this.pluginId = options.pluginId
    this.version = options.version
    this.allowedHosts = options.allowedHosts
    this.fetchImpl = options.fetchImpl || globalThis.fetch
  }

  private validateUrl(rawUrl: string, init: SafeHttpRequestInit): URL {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      throw new SafeHttpError(
        NormalizedProviderError.create(
          this.pluginId,
          this.version,
          'UNSAFE_URL',
          `Invalid URL: ${rawUrl}`,
        ).diagnostic,
      )
    }
    if (parsed.protocol !== 'https:' && !(init.allowInsecureProtocol === true && parsed.protocol === 'http:')) {
      throw new SafeHttpError(
        NormalizedProviderError.create(
          this.pluginId,
          this.version,
          'UNSAFE_URL',
          `Insecure protocol '${parsed.protocol}'; only HTTPS is permitted`,
        ).diagnostic,
      )
    }

    const hostname = parsed.hostname.toLowerCase()
    const allowed = init.allowedHosts || this.allowedHosts

    const isAllowed = hostMatchesAllowlist(hostname, allowed)

    if (!isAllowed) {
      throw new SafeHttpError(
        NormalizedProviderError.create(
          this.pluginId,
          this.version,
          'UNSAFE_URL',
          `Host '${hostname}' is not in allowed hosts list: [${allowed.join(', ')}]`,
        ).diagnostic,
      )
    }

    return parsed
  }

  async request(url: string, init: SafeHttpRequestInit = {}): Promise<SafeHttpResponse> {
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES
    const method = init.method ?? 'GET'

    const controller = new AbortController()
    let timedOut = false
    let cancelBody: (() => void) | undefined
    const abortError = () => timedOut
      ? NormalizedProviderError.create(this.pluginId, this.version, 'PROVIDER_TIMEOUT', `Request timed out after ${timeoutMs}ms`)
      : new DOMException('Request canceled', 'AbortError')
    const cleanup = () => {
      clearTimeout(timer)
      init.signal?.removeEventListener('abort', onExternalAbort)
      controller.signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => { cancelBody?.(); cleanup() }
    const onExternalAbort = () => controller.abort()
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    controller.signal.addEventListener('abort', onAbort, { once: true })
    init.signal?.addEventListener('abort', onExternalAbort, { once: true })
    if (init.signal?.aborted) controller.abort()
    const checkAbort = () => { if (controller.signal.aborted) throw abortError() }
    const unsafeRedirect = (detail: string) => new SafeHttpError(
      NormalizedProviderError.create(this.pluginId, this.version, 'UNSAFE_URL', detail).diagnostic,
    )

    let currentUrl = url
    let redirectsFollowed = 0
    try {
      while (true) {
        checkAbort()
        const validatedUrl = this.validateUrl(currentUrl, init)
        const res = await this.fetchImpl(validatedUrl.toString(), {
          method,
          headers: init.headers,
          body: init.body as BodyInit | null | undefined,
          redirect: 'manual',
          signal: controller.signal,
        })
        cancelBody = () => cancelWithoutWaiting(res.body)
        if (controller.signal.aborted) { cancelBody(); checkAbort() }

        // Every redirect hop is independently allowlisted; discard its body.
        if (res.status >= 301 && res.status <= 308) {
          cancelWithoutWaiting(res.body)
          checkAbort()
          const location = res.headers.get('location')
          if (!location) throw unsafeRedirect('Redirect missing Location')
          try { currentUrl = new URL(location, validatedUrl).toString() }
          catch { throw unsafeRedirect('Invalid redirect Location') }
          if (++redirectsFollowed > MAX_REDIRECTS) throw unsafeRedirect('Exceeded maximum redirect limit')
          continue
        }
        return this.wrapResponse(res, currentUrl, maxBytes, cleanup, checkAbort, cancel => { cancelBody = cancel })
      }
    } catch (err) {
      cleanup()
      checkAbort()
      if (err instanceof NormalizedProviderError) throw err
      // Legacy clients treat a transport-originated AbortError as a timeout.
      if (err instanceof Error && err.name === 'AbortError') {
        throw NormalizedProviderError.create(this.pluginId, this.version, 'PROVIDER_TIMEOUT', `Request timed out after ${timeoutMs}ms`)
      }
      throw NormalizedProviderError.create(this.pluginId, this.version, 'PROVIDER_TEMPORARY_ERROR', err instanceof Error ? err.message : 'Network transport failure')
    }
  }

  get(url: string, init?: Omit<SafeHttpRequestInit, 'method'>): Promise<SafeHttpResponse> {
    return this.request(url, { ...init, method: 'GET' })
  }

  post(
    url: string,
    body?: string | FormData | Buffer | Uint8Array,
    init?: Omit<SafeHttpRequestInit, 'method' | 'body'>,
  ): Promise<SafeHttpResponse> {
    return this.request(url, { ...init, method: 'POST', body })
  }

  private wrapResponse(
    rawResponse: Response,
    url: string,
    maxBytes: number,
    cleanup: () => void,
    checkAbort: () => void,
    setCancelBody: (cancel: () => void) => void,
  ): SafeHttpResponse {
    let readStarted = false
    let cachedBuffer: Buffer | null = null
    const tooLarge = () => new SafeHttpError(NormalizedProviderError.create(
      this.pluginId, this.version, 'OUTPUT_READ_FAILED', `Response body exceeded maximum allowed size of ${maxBytes} bytes`,
    ).diagnostic)

    const openReader = () => {
      if (readStarted) throw new Error('Response stream has already been read')
      readStarted = true
      checkAbort()
      const length = Number(rawResponse.headers.get('content-length'))
      if (length > maxBytes) {
        cancelWithoutWaiting(rawResponse.body)
        cleanup()
        throw tooLarge()
      }
      const reader = rawResponse.body?.getReader()
      setCancelBody(() => cancelWithoutWaiting(reader))
      return reader
    }

    const readBoundedBuffer = async (): Promise<Buffer> => {
      if (cachedBuffer) return cachedBuffer
      const reader = openReader()
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      try {
        if (reader) while (true) {
          checkAbort()
          const { done, value } = await reader.read()
          checkAbort()
          if (done) break
          totalBytes += value.byteLength
          if (totalBytes > maxBytes) throw tooLarge()
          chunks.push(value)
        }
        cachedBuffer = Buffer.concat(chunks, totalBytes)
        return cachedBuffer
      } catch (error) {
        cancelWithoutWaiting(reader)
        checkAbort()
        throw error
      } finally {
        cleanup()
        reader?.releaseLock()
      }
    }

    return {
      status: rawResponse.status,
      statusText: rawResponse.statusText,
      headers: rawResponse.headers,
      ok: rawResponse.ok,
      url,
      text: async () => (await readBoundedBuffer()).toString('utf8'),
      json: async <T = unknown>() => JSON.parse((await readBoundedBuffer()).toString('utf8')) as T,
      buffer: readBoundedBuffer,
      stream: () => {
        const reader = openReader()
        let totalBytes = 0
        let finished = false
        const finish = () => {
          if (finished) return
          finished = true
          cleanup()
          reader?.releaseLock()
        }
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              checkAbort()
              const next = reader ? await reader.read() : { done: true, value: undefined }
              if (finished) return
              checkAbort()
              if (next.done) { finish(); controller.close(); return }
              totalBytes += next.value!.byteLength
              if (totalBytes > maxBytes) throw tooLarge()
              controller.enqueue(next.value!)
            } catch (error) {
              if (finished) return
              cancelWithoutWaiting(reader)
              finish()
              controller.error(error)
            }
          },
          cancel(reason) {
            cancelWithoutWaiting(reader, reason)
            finish()
          },
        })
      },
    }
  }
}
