import test from 'node:test'
import assert from 'node:assert/strict'
import { isPrivateProviderHost, urlHostOf } from './index'

test('isPrivateProviderHost covers loopback, link-local and RFC1918 ranges', () => {
  for (const host of ['localhost', 'LOCALHOST', '0.0.0.0', '::1', '127.0.0.1', '10.1.2.3', '192.168.0.9', '169.254.1.1', '172.16.0.1', '172.31.255.254']) {
    assert.equal(isPrivateProviderHost(host), true, host)
  }
  for (const host of ['api.openai.com', '172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.1.1']) {
    assert.equal(isPrivateProviderHost(host), false, host)
  }
})

test('isPrivateProviderHost normalizes IPv6 brackets, compression and mapped IPv4 literals', () => {
  const privateHosts = [
    '::', '::1', '0:0:0:0:0:0:0:0', '0:0:0:0:0:0:0:1',
    'fc00::1', 'fd00::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    'fe80::1', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '::ffff:0.0.0.0', '::ffff:127.0.0.1', '::ffff:10.1.2.3',
    '::ffff:192.168.0.9', '::ffff:169.254.1.1', '::ffff:172.16.0.1', '::ffff:172.31.255.254',
    '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::FFFF:7F00:1',
    '::ffff:a01:203', '::ffff:c0a8:9', '::ffff:a9fe:101', '::ffff:ac10:1', '::ffff:ac1f:fffe',
  ]
  for (const literal of privateHosts) {
    for (const host of [literal, `[${literal}]`, new URL(`https://[${literal}]/`).hostname]) {
      assert.equal(isPrivateProviderHost(host), true, host)
    }
  }
})

test('isPrivateProviderHost leaves public IPv6 and mapped IPv4 range boundaries unaffected', () => {
  for (const literal of [
    '2001:4860:4860::8888', '2606:4700:4700::1111', '2001:db8::1',
    'fbff::1', 'fe00::1', 'fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fec0::1',
    '::ffff:8.8.8.8', '::ffff:126.255.255.255', '::ffff:128.0.0.1', '::ffff:11.0.0.1',
    '::ffff:172.15.255.255', '::ffff:172.32.0.1', '::ffff:192.169.1.1', '::ffff:169.255.1.1',
    '::ffff:808:808', '::ffff:ac0f:ffff', '::ffff:ac20:1',
  ]) {
    for (const host of [literal, `[${literal}]`, new URL(`https://[${literal}]/`).hostname]) {
      assert.equal(isPrivateProviderHost(host), false, host)
    }
  }
  for (const malformed of [':::', '::gggg', '[::1', '::1]', '1:2:3:4:5:6:7:8:9', 'not:a:host', '::1%eth0']) {
    assert.equal(isPrivateProviderHost(malformed), false, malformed)
  }
})

test('urlHostOf returns the hostname or null without throwing', () => {
  assert.equal(urlHostOf('https://api.openai.com/v1/chat/completions'), 'api.openai.com')
  assert.equal(urlHostOf('http://127.0.0.1:3000/x'), '127.0.0.1')
  assert.equal(urlHostOf('not-a-url'), null)
  assert.equal(urlHostOf(''), null)
  assert.equal(urlHostOf('ark.cn-beijing.volces.com'), null)
})
