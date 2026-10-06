import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLanguageModelChatRequest, callLanguageModelChat, LanguageModelChatError, parseLanguageModelChatResponse } from './index'
import type { LanguageModelChatInput, LanguageModelChatMessage } from './index'

const tools = [{ name: 'get_canvas', description: 'Read canvas', parameters: { type: 'object', properties: {} } }, { name: 'add_node', parameters: { type: 'object', properties: { title: { type: 'string' } } } }]
const input: LanguageModelChatInput = { protocol: 'openai_chat', vendorModelId: 'model', apiKey: 'tiny-secret', system: 'private system prompt', messages: [{ role: 'user', content: 'private user prompt' }], tools, maxOutputTokens: 100, timeoutMs: 1000 }
const calls = [{ id: 'call_1', name: 'get_canvas', arguments: {} }, { id: 'call_2', name: 'add_node', arguments: { title: '猫' } }]
const openai = { id: 'chatcmpl-1', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }
const anthropic = { id: 'msg_1', type: 'message', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'text', text: 'First' }, { type: 'tool_use', id: 'call_1', name: 'get_canvas', input: {} }, { type: 'text', text: 'Second' }, { type: 'tool_use', id: 'call_2', name: 'add_node', input: { title: '猫' } }], usage: { input_tokens: 20, output_tokens: 10 } }
function errorCode(code: string) { return (error: unknown) => error instanceof LanguageModelChatError && error.code === code && error.message === code }
async function withFetch(fetchImpl: typeof fetch, action: () => Promise<void>) {
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  try { await action() } finally { globalThis.fetch = original }
}

test('language-model-chat: OpenAI two-turn parallel tools and paired results fixture', () => {
  const first = buildLanguageModelChatRequest({ ...input, reasoningEffort: 'high' })
  assert.equal(first.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(first.headers.authorization, 'Bearer tiny-secret')
  assert.equal(first.body.stream, false)
  assert.equal(first.body.reasoning_effort, 'high')
  assert.deepEqual(first.body.tools, tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })))
  const result = parseLanguageModelChatResponse(input.protocol, openai, tools)
  assert.equal(result.text, '')
  assert.deepEqual(result.toolCalls, calls)
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10 })
  const history: LanguageModelChatMessage[] = [...input.messages, { role: 'assistant', content: result.text, toolCalls: result.toolCalls, contentBlocks: result.contentBlocks }, { role: 'tool', toolCallId: 'call_2', content: 'created' }, { role: 'tool', toolCallId: 'call_1', content: '{}' }]
  const second = buildLanguageModelChatRequest({ ...input, messages: history })
  assert.deepEqual((second.body.messages as unknown[]).slice(2), [{ role: 'assistant', content: null, tool_calls: openai.choices[0].message.tool_calls }, { role: 'tool', tool_call_id: 'call_2', content: 'created' }, { role: 'tool', tool_call_id: 'call_1', content: '{}' }])
  const answer = parseLanguageModelChatResponse('openai_chat', { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Done' } }] }, tools)
  assert.equal(answer.text, 'Done')
})

test('language-model-chat: Anthropic preserves ordered blocks and groups parallel results into user turn', () => {
  const result = parseLanguageModelChatResponse('anthropic_messages', anthropic, tools)
  assert.equal(result.text, 'FirstSecond')
  assert.deepEqual(result.toolCalls, calls)
  assert.equal(result.referenceId, 'msg_1')
  const request = buildLanguageModelChatRequest({ ...input, protocol: 'anthropic_messages', credential: { schema: 'legacy-api-key-v1', apiKey: 'credential-key', baseUrl: 'https://compatible.example/v1' }, apiKey: undefined, messages: [...input.messages, { role: 'assistant', content: result.text, toolCalls: result.toolCalls, contentBlocks: result.contentBlocks }, { role: 'tool', toolCallId: 'call_1', content: '{}' }, { role: 'tool', toolCallId: 'call_2', content: 'failed', isError: true }] })
  assert.equal(request.url, 'https://compatible.example/v1/messages')
  assert.equal(request.headers['x-api-key'], 'credential-key')
  assert.equal(request.body.system, input.system)
  assert.equal(request.body.max_tokens, input.maxOutputTokens)
  assert.equal(request.body.stream, false)
  assert.deepEqual(request.body.tools, tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })))
  assert.deepEqual(request.body.messages, [{ role: 'user', content: [{ type: 'text', text: 'private user prompt' }] }, { role: 'assistant', content: anthropic.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{}' }, { type: 'tool_result', tool_use_id: 'call_2', content: 'failed', is_error: true }] }])
  assert.equal(parseLanguageModelChatResponse('anthropic_messages', { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done' }] }, tools).text, 'Done')
  assert.equal(parseLanguageModelChatResponse('anthropic_messages', { ...anthropic, content: anthropic.content.filter(block => block.type === 'tool_use') }, tools).text, '')
})

test('language-model-chat: Anthropic HTTP second turn serializes results and rejects reused call IDs', async () => {
  let turn = 0
  await withFetch(async (_url, init) => {
    const body = JSON.parse(init?.body as string)
    turn++
    if (turn === 1) return Response.json(anthropic)
    assert.deepEqual(body.messages.at(-1).content, [{ type: 'tool_result', tool_use_id: 'call_1', content: '{}' }, { type: 'tool_result', tool_use_id: 'call_2', content: 'created' }])
    if (turn === 2) return Response.json({ type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Complete' }] })
    return Response.json(anthropic)
  }, async () => {
    const config = { ...input, protocol: 'anthropic_messages' as const }
    const first = await callLanguageModelChat(config)
    const messages: LanguageModelChatMessage[] = [...input.messages, { role: 'assistant', content: first.text, toolCalls: first.toolCalls, contentBlocks: first.contentBlocks }, { role: 'tool', toolCallId: 'call_1', content: '{}' }, { role: 'tool', toolCallId: 'call_2', content: 'created' }]
    assert.equal((await callLanguageModelChat({ ...config, messages })).text, 'Complete')
    await assert.rejects(callLanguageModelChat({ ...config, messages }), errorCode('LANGUAGE_MODEL_RESPONSE_INVALID'))
  })
})

test('language-model-chat: rejects unsupported protocol/plugin identities/config without fetching', async () => {
  await withFetch(async () => { assert.fail('must not fetch') }, async () => {
    for (const config of [{ protocol: 'openai_responses' as const }, { pluginId: 'uploaded', pluginVersion: '1.0.0' }, { pluginId: 'uploaded' }, { pluginId: 'openai-language', pluginVersion: '2.0.0' }, { pluginId: 'anthropic-language', pluginVersion: '1.0.0' }, { credential: { schema: 'json-v1', apiKey: 'secret' } }, { protocol: 'anthropic_messages' as const, reasoningEffort: 'high' as const }]) {
      await assert.rejects(callLanguageModelChat({ ...input, ...config }), errorCode('LANGUAGE_MODEL_UNSUPPORTED'))
    }
    for (const config of [{ timeoutMs: 0 }, { maxOutputTokens: -1 }, { apiKey: '' }, { baseUrl: 'https://user:pass@example.com' }, { baseUrl: 'https://example.com?api_key=tiny-secret' }, { baseUrl: 'bad tiny-secret' }]) await assert.rejects(callLanguageModelChat({ ...input, ...config }), errorCode('LANGUAGE_MODEL_REJECTED'))
    assert.doesNotThrow(() => buildLanguageModelChatRequest({ ...input, pluginId: 'openai-language', pluginVersion: '1.0.0' }))
  })
})

test('language-model-chat: rejects orphan, duplicate, missing, reordered turns and inconsistent ordered blocks in history', () => {
  const assistant: LanguageModelChatMessage = { role: 'assistant', content: '', toolCalls: calls }
  for (const messages of [
    [{ role: 'tool', toolCallId: 'missing', content: '{}' }],
    [...input.messages, assistant],
    [...input.messages, assistant, { role: 'user', content: 'interrupt' }],
    [...input.messages, assistant, { role: 'tool', toolCallId: 'call_1', content: '{}' }, { role: 'tool', toolCallId: 'call_1', content: '{}' }],
    [...input.messages, { role: 'assistant', content: 'wrong', toolCalls: [], contentBlocks: [{ type: 'text', text: 'right' }] }],
  ]) assert.throws(() => buildLanguageModelChatRequest({ ...input, messages: messages as LanguageModelChatMessage[] }), errorCode('LANGUAGE_MODEL_RESPONSE_INVALID'))
})

test('language-model-chat: strict OpenAI response validation', () => {
  const wireCall = openai.choices[0].message.tool_calls[0]
  const response = (tool_calls: unknown, finish_reason = 'tool_calls', content: unknown = null) => ({ choices: [{ finish_reason, message: { role: 'assistant', content, tool_calls } }] })
  for (const raw of [null, {}, { choices: [] }, { choices: [...openai.choices, ...openai.choices] }, response([wireCall, wireCall]), response([{ ...wireCall, id: 'invalid id' }]), response([{ ...wireCall, function: { name: 'unknown', arguments: '{}' } }]), response([{ ...wireCall, type: 'custom' }]), ...['bad json', 'null', '[]', '42', '{"__proto__":{}}', '{"nested":{"constructor":{}}}', '{"prototype":1}'].map(args => response([{ ...wireCall, function: { name: 'get_canvas', arguments: args } }])), ...['length', 'content_filter', 'stop', 'unknown', null].map(reason => response([wireCall], reason as string)), response([], 'stop', ''), response([], 'stop', 123), { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok', refusal: 'refused' } }] }, { ...openai, usage: { prompt_tokens: -1 } }]) {
    assert.throws(() => parseLanguageModelChatResponse('openai_chat', raw, tools), errorCode('LANGUAGE_MODEL_RESPONSE_INVALID'))
  }
  assert.throws(() => parseLanguageModelChatResponse('openai_chat', openai, tools, ['call_1']), errorCode('LANGUAGE_MODEL_RESPONSE_INVALID'))
})

test('language-model-chat: strict Anthropic response validation', () => {
  for (const raw of [
    { ...anthropic, content: [anthropic.content[1], anthropic.content[1]] },
    { ...anthropic, content: [{ type: 'tool_use', id: 'call_1', name: 'unknown', input: {} }] },
    { ...anthropic, content: [{ type: 'tool_use', id: 'call_1', name: 'get_canvas', input: JSON.parse('{"__proto__":{}}') }] },
    { ...anthropic, content: [{ type: 'tool_use', id: 'call_1', name: 'get_canvas', input: [] }] },
    { ...anthropic, content: [{ type: 'thinking', thinking: 'not supported' }] },
    ...['max_tokens', 'pause_turn', 'refusal', 'end_turn', null].map(stop_reason => ({ ...anthropic, stop_reason })),
    { ...anthropic, content: [{ type: 'text', text: 'ok' }], stop_reason: 'tool_use' },
    { ...anthropic, usage: { input_tokens: '20' } },
  ]) assert.throws(() => parseLanguageModelChatResponse('anthropic_messages', raw, tools), errorCode('LANGUAGE_MODEL_RESPONSE_INVALID'))
})

test('language-model-chat: uses safe configured host and blocks off-host redirects/insecure/private URLs', async () => {
  const privateFlag = process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL
  const insecureFlag = process.env.ALLOW_INSECURE_PROVIDER_BASE_URL
  delete process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL
  delete process.env.ALLOW_INSECURE_PROVIDER_BASE_URL
  try {
    let count = 0
    await withFetch(async (url, init) => {
      count++
      assert.equal(String(url), 'https://compatible.example/v1/chat/completions')
      assert.equal(init?.redirect, 'manual')
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer tiny-secret')
      return Response.json(openai)
    }, async () => { assert.deepEqual((await callLanguageModelChat({ ...input, baseUrl: 'https://compatible.example/v1' })).toolCalls, calls) })
    assert.equal(count, 1)
    await withFetch(async () => new Response('', { status: 302, headers: { location: 'https://evil.example/secret' } }), async () => { await assert.rejects(callLanguageModelChat(input), errorCode('LANGUAGE_MODEL_REJECTED')) })
    await withFetch(async () => { assert.fail('must not fetch') }, async () => {
      for (const baseUrl of ['http://compatible.example', 'https://127.0.0.1', 'https://[::1]', 'https://10.0.0.1']) await assert.rejects(callLanguageModelChat({ ...input, baseUrl }), errorCode('LANGUAGE_MODEL_REJECTED'))
    })
    process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL = 'true'
    process.env.ALLOW_INSECURE_PROVIDER_BASE_URL = 'true'
    await withFetch(async url => { assert.equal(String(url), 'http://127.0.0.1:8080/v1/chat/completions'); return Response.json(openai) }, async () => {
      assert.deepEqual((await callLanguageModelChat({ ...input, baseUrl: 'http://127.0.0.1:8080' })).toolCalls, calls)
    })
  } finally {
    if (privateFlag === undefined) delete process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL; else process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL = privateFlag
    if (insecureFlag === undefined) delete process.env.ALLOW_INSECURE_PROVIDER_BASE_URL; else process.env.ALLOW_INSECURE_PROVIDER_BASE_URL = insecureFlag
  }
})

test('language-model-chat: private IPv6 and mapped literals fail before fetch unless explicitly opted in', async () => {
  const privateFlag = process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL
  const insecureFlag = process.env.ALLOW_INSECURE_PROVIDER_BASE_URL
  delete process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL
  delete process.env.ALLOW_INSECURE_PROVIDER_BASE_URL
  const literals = ['::', '::1', 'fc00::1', 'fd00::1', 'fe80::1', 'febf::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:192.168.1.1', '::ffff:169.254.1.1', '::ffff:172.16.0.1']
  try {
    for (const protocol of ['openai_chat', 'anthropic_messages'] as const) {
      await withFetch(async () => { assert.fail('private literal must be rejected before credential-bearing fetch') }, async () => {
        for (const literal of literals) await assert.rejects(callLanguageModelChat({ ...input, protocol, baseUrl: `https://[${literal}]` }), errorCode('LANGUAGE_MODEL_REJECTED'))
      })
      process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL = 'true'
      for (const literal of literals) await withFetch(async (url, init) => {
        const path = protocol === 'openai_chat' ? '/v1/chat/completions' : '/v1/messages'
        assert.equal(String(url), new URL(`https://[${literal}]${path}`).toString())
        const headers = init?.headers as Record<string, string>
        assert.equal(protocol === 'openai_chat' ? headers.authorization : headers['x-api-key'], protocol === 'openai_chat' ? 'Bearer tiny-secret' : 'tiny-secret')
        return Response.json(protocol === 'openai_chat' ? openai : anthropic)
      }, async () => {
        assert.deepEqual((await callLanguageModelChat({ ...input, protocol, baseUrl: `https://[${literal}]` })).toolCalls, calls)
      })
      delete process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL
    }
    await withFetch(async () => Response.json(openai), async () => {
      assert.deepEqual((await callLanguageModelChat({ ...input, baseUrl: 'https://[2001:4860:4860::8888]' })).toolCalls, calls)
    })
  } finally {
    if (privateFlag === undefined) delete process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL; else process.env.ALLOW_PRIVATE_PROVIDER_BASE_URL = privateFlag
    if (insecureFlag === undefined) delete process.env.ALLOW_INSECURE_PROVIDER_BASE_URL; else process.env.ALLOW_INSECURE_PROVIDER_BASE_URL = insecureFlag
  }
})

test('language-model-chat: cancellation/timeout during fetch and body consumption are distinct', async () => {
  for (const duringRead of [false, true]) for (const canceled of [false, true]) {
    const abort = new AbortController()
    let stopped = false
    await withFetch(async (_url, init) => {
      if (duringRead) return new Response(new ReadableStream({ cancel() { stopped = true } }))
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => { stopped = true; reject(new DOMException('tiny-secret private prompt', 'AbortError')) }, { once: true }))
    }, async () => {
      const timer = canceled ? setTimeout(() => abort.abort(), 10) : undefined
      try { await assert.rejects(callLanguageModelChat({ ...input, signal: abort.signal, timeoutMs: canceled ? 1000 : 15 }), errorCode(canceled ? 'LANGUAGE_MODEL_CANCELED' : 'LANGUAGE_MODEL_TIMEOUT')) }
      finally { clearTimeout(timer) }
      assert.equal(stopped, true)
    })
  }
  const signal = AbortSignal.abort('tiny-secret')
  await assert.rejects(callLanguageModelChat({ ...input, signal }), errorCode('LANGUAGE_MODEL_CANCELED'))
})

test('language-model-chat: 10MB limit on declared and actual bodies', async () => {
  for (const declared of [true, false]) {
    let stopped = false
    await withFetch(async () => new Response(new ReadableStream({ start(controller) { if (!declared) controller.enqueue(new Uint8Array(10_000_001)) }, cancel() { stopped = true } }), { headers: declared ? { 'content-length': '10000001' } : {} }), async () => {
      await assert.rejects(callLanguageModelChat(input), errorCode('LANGUAGE_MODEL_RESPONSE_TOO_LARGE'))
      assert.equal(stopped, true)
    })
  }
})

test('language-model-chat: status/error redaction excludes raw bodies, URLs, prompts and credentials without logging', async () => {
  let logged = false
  const warn = console.warn
  const error = console.error
  console.warn = console.error = () => { logged = true }
  try {
    for (const status of [400, 401, 408, 429, 500]) await withFetch(async () => new Response(`tiny-secret ${input.system} ${input.messages[0].content} https://user:pass@example.com?key=tiny-secret`, { status, statusText: 'tiny-secret' }), async () => {
      await assert.rejects(callLanguageModelChat(input), (value: unknown) => {
        assert.ok(value instanceof LanguageModelChatError)
        assert.equal(value.code, [408, 429, 500].includes(status) ? 'LANGUAGE_MODEL_TEMPORARY_ERROR' : 'LANGUAGE_MODEL_REJECTED')
        assert.equal(value.status, status)
        assert.doesNotMatch(JSON.stringify(value) + value.stack, /tiny-secret|private system|private user|user:pass/)
        return true
      })
    })
    await withFetch(async () => { throw new Error('tiny-secret https://user:pass@example.com') }, async () => { await assert.rejects(callLanguageModelChat(input), errorCode('LANGUAGE_MODEL_TEMPORARY_ERROR')) })
    await withFetch(async () => new Response('tiny-secret not JSON'), async () => { await assert.rejects(callLanguageModelChat(input), errorCode('LANGUAGE_MODEL_RESPONSE_INVALID')) })
    assert.equal(logged, false)
  } finally { console.warn = warn; console.error = error }
})
