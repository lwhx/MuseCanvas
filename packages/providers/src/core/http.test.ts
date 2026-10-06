import assert from 'node:assert/strict'
import test from 'node:test'
import { getEventListeners } from 'node:events'
import { DefaultSafeHttpClient } from './http'
import { NormalizedProviderError } from './errors'

const url = 'https://api.example.com/test'
const client = (fetchImpl: typeof fetch) => new DefaultSafeHttpClient({ pluginId: 'test', version: '1', allowedHosts: ['api.example.com'], fetchImpl })
const timeout = (value: unknown) => value instanceof NormalizedProviderError && value.diagnostic.code === 'PROVIDER_TIMEOUT'
const canceled = (value: unknown) => value instanceof Error && value.name === 'AbortError'
const tooLarge = (value: unknown) => value instanceof NormalizedProviderError && value.diagnostic.code === 'OUTPUT_READ_FAILED'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('http: caller cancellation covers fetch and pre-aborted signals without retaining listeners', async () => {
  const abort = new AbortController()
  let stopped = false
  const http = client(async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { stopped = true; reject(new DOMException('aborted', 'AbortError')) }, { once: true })
  }))
  const result = http.get(url, { signal: abort.signal, timeoutMs: 1000 })
  assert.equal(getEventListeners(abort.signal, 'abort').length, 1)
  abort.abort()
  await assert.rejects(result, canceled)
  assert.equal(stopped, true)
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  await assert.rejects(client(async () => { assert.fail('must not fetch') }).get(url, { signal: AbortSignal.abort() }), canceled)
})

test('http: one deadline covers fetch, redirect hops and body (never resets at headers)', async () => {
  const http = client(async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))
  await assert.rejects(http.get(url, { timeoutMs: 10 }), timeout)
  await assert.rejects(client(async () => { throw new DOMException('transport abort', 'AbortError') }).get(url), timeout)
  let bodyCanceled = false
  const response = await client(async () => { await delay(15); return new Response(new ReadableStream({ cancel() { bodyCanceled = true } })) }).get(url, { timeoutMs: 30 })
  await assert.rejects(response.text(), timeout)
  assert.equal(bodyCanceled, true)
  let hop = 0
  const redirects = client(async () => {
    await delay(12)
    hop++
    return new Response(new ReadableStream(), { status: 302, headers: { location: '/next' } })
  })
  await assert.rejects(redirects.get(url, { timeoutMs: 20 }), timeout)
  assert.equal(hop, 2)
})

test('http: cancellation and timeout wake pending bounded and streaming reads and cancel source', async () => {
  for (const streaming of [false, true]) for (const external of [false, true]) {
    const abort = new AbortController()
    let stopped = false
    const response = await client(async () => new Response(new ReadableStream({ cancel() { stopped = true } }))).get(url, { signal: abort.signal, timeoutMs: external ? 1000 : 15 })
    const pending = streaming ? response.stream().getReader().read() : response.buffer()
    if (external) abort.abort()
    await assert.rejects(pending, external ? canceled : timeout)
    assert.equal(stopped, true)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  }
})

test('http: canceled unread body is discarded, including cancellation before body access', async () => {
  const abort = new AbortController()
  let stopped = false
  const response = await client(async () => new Response(new ReadableStream({ cancel() { stopped = true } }))).get(url, { signal: abort.signal })
  abort.abort()
  assert.equal(stopped, true)
  await assert.rejects(response.text(), canceled)
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
})

test('http: all redirect bodies discarded before next hop or unsafe redirect rejection', async () => {
  for (const location of ['/next', 'https://evil.example/test', '', 'http://[bad']) {
    let discarded = 0
    let fetched = 0
    const abort = new AbortController()
    const http = client(async () => {
      fetched++
      if (fetched > 1) return new Response('ok')
      return new Response(new ReadableStream({ cancel() { discarded++ } }), { status: 302, headers: location ? { location } : {} })
    })
    if (location === '/next') assert.equal(await (await http.get(url, { signal: abort.signal })).text(), 'ok')
    else await assert.rejects(http.get(url, { signal: abort.signal }), (value: unknown) => value instanceof NormalizedProviderError && value.diagnostic.code === 'UNSAFE_URL')
    assert.equal(discarded, 1)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  }
})

test('http: bounded/streaming body limits discard sources and clean listeners', async () => {
  for (const streaming of [false, true]) for (const declared of [false, true]) {
    let stopped = false
    const abort = new AbortController()
    const response = await client(async () => new Response(new ReadableStream({ start(controller) { if (!declared) controller.enqueue(new Uint8Array(11)) }, cancel() { stopped = true } }), { headers: declared ? { 'content-length': '11' } : {} })).get(url, { maxBytes: 10, signal: abort.signal })
    if (streaming && declared) assert.throws(() => response.stream(), tooLarge)
    else await assert.rejects(streaming ? response.stream().getReader().read() : response.text(), tooLarge)
    assert.equal(stopped, true)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  }
})

test('http: redirect discard never waits for a hanging or rejected cancellation acknowledgement', { timeout: 1500 }, async () => {
  for (const rejects of [false, true]) for (const mode of ['next', 'unsafe', 'timeout']) {
    let discarded = 0
    let fetched = 0
    const abort = new AbortController()
    const http = client(async (_url, init) => {
      fetched++
      if (fetched > 1) {
        if (mode === 'timeout') return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('deadline', 'AbortError')), { once: true })
        })
        return new Response('ok')
      }
      return new Response(new ReadableStream({ cancel() {
        discarded++
        return rejects ? Promise.reject(new Error('discard failed')) : new Promise<void>(() => {})
      } }), { status: 302, headers: { location: mode === 'unsafe' ? 'https://evil.example/test' : '/next' } })
    })
    const request = http.get(url, { signal: abort.signal, timeoutMs: 10 })
    if (mode === 'next') assert.equal(await (await request).text(), 'ok')
    else await assert.rejects(request, mode === 'timeout' ? timeout : (value: unknown) => value instanceof NormalizedProviderError && value.diagnostic.code === 'UNSAFE_URL')
    assert.equal(discarded, 1)
    assert.equal(fetched, mode === 'unsafe' ? 1 : 2)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  }
})

test('http: oversize cleanup releases listeners/read locks without awaiting cancellation acknowledgement', { timeout: 1500 }, async () => {
  for (const streaming of [false, true]) for (const declared of [false, true]) for (const rejects of [false, true]) {
    let discarded = 0
    const abort = new AbortController()
    const raw = new Response(new ReadableStream({
      start(controller) { if (!declared) controller.enqueue(new Uint8Array(11)) },
      cancel() { discarded++; return rejects ? Promise.reject(new Error('cancel failed')) : new Promise<void>(() => {}) },
    }), { headers: declared ? { 'content-length': '11' } : {} })
    const response = await client(async () => raw).get(url, { maxBytes: 10, signal: abort.signal, timeoutMs: 1000 })
    if (streaming && declared) assert.throws(() => response.stream(), tooLarge)
    else await assert.rejects(streaming ? response.stream().getReader().read() : response.buffer(), tooLarge)
    assert.equal(discarded, 1)
    assert.equal(raw.body?.locked, false)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  }
})

test('http: read-error cleanup does not wait for a source that never acknowledges cancellation', { timeout: 1500 }, async () => {
  for (const streaming of [false, true]) {
    let discarded = 0
    const abort = new AbortController()
    const body = new ReadableStream<Uint8Array>({ cancel() { discarded++; return new Promise<void>(() => {}) } })
    const raw = new Response(body)
    const reader = body.getReader()
    // Inject a read failure while leaving the source open to exercise catch-path cancellation.
    reader.read = async () => { throw new Error('read failure') }
    Object.defineProperty(body, 'getReader', { value: () => reader })
    const response = await client(async () => raw).get(url, { signal: abort.signal, timeoutMs: 1000 })
    await assert.rejects(streaming ? response.stream().getReader().read() : response.text(), /read failure/)
    assert.equal(discarded, 1)
    assert.equal(body.locked, false)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  }
})

test('http: hanging cancellation acknowledgement cannot block deadline, external abort or explicit stream cancel', { timeout: 1500 }, async () => {
  for (const streaming of [false, true]) for (const external of [false, true]) {
    const abort = new AbortController()
    let discarded = 0
    const body = new ReadableStream<Uint8Array>({ cancel() { discarded++; return new Promise<void>(() => {}) } })
    const response = await client(async () => new Response(body)).get(url, { signal: abort.signal, timeoutMs: external ? 1000 : 10 })
    const pending = streaming ? response.stream().getReader().read() : response.text()
    if (external) abort.abort()
    await assert.rejects(pending, external ? canceled : timeout)
    assert.equal(discarded, 1)
    assert.equal(body.locked, false)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  }
  const abort = new AbortController()
  let discarded = 0
  const body = new ReadableStream<Uint8Array>({ cancel() { discarded++; return new Promise<void>(() => {}) } })
  const response = await client(async () => new Response(body)).get(url, { signal: abort.signal, timeoutMs: 1000 })
  const reader = response.stream().getReader()
  const pending = reader.read()
  await Promise.resolve() // Start a pending source read before explicit cancellation.
  await reader.cancel()
  assert.equal((await pending).done, true)
  assert.equal(discarded, 1)
  assert.equal(body.locked, false)
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
})

test('http: cleanup on transport/read failures, success and explicit stream cancellation; old cache behavior retained', async () => {
  const abort = new AbortController()
  await assert.rejects(client(async () => { throw new Error('offline') }).get(url, { signal: abort.signal }))
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  for (const streaming of [false, true]) {
    const response = await client(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('read failure')) } }))).get(url, { signal: abort.signal })
    await assert.rejects(streaming ? response.stream().getReader().read() : response.text(), /read failure/)
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  }
  let transportSignal: AbortSignal | null | undefined
  const response = await client(async (_url, init) => { transportSignal = init?.signal; return new Response('{"ok":true}') }).get(url, { signal: abort.signal, timeoutMs: 20 })
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(await response.text(), '{"ok":true}')
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  await delay(30)
  assert.equal(transportSignal?.aborted, false, 'successful body consumption cleared deadline')
  let stopped = false
  const stream = (await client(async () => new Response(new ReadableStream({ cancel() { stopped = true } }))).get(url, { signal: abort.signal })).stream()
  await stream.cancel()
  assert.equal(stopped, true)
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0)
  const body = (await client(async () => new Response('old client')).get(url)).stream()
  const reader = body.getReader()
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'old client')
  assert.equal((await reader.read()).done, true)
})
