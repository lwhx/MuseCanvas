/**
 * Shared URL / host guards for provider egress policy.
 *
 * One private-address definition so the plugin scanner, apps/api and apps/worker all
 * enforce the same SSRF rule. Pure: no node builtins, no I/O.
 */

/** Literal private / loopback / link-local host test; does not resolve DNS. */
export function isPrivateProviderHost(host: string): boolean {
  const lower = host.toLowerCase()
  const h = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower
  if (!h.includes(':')) {
    return h === 'localhost' || h === '0.0.0.0' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  }

  // URL canonicalizes valid IPv6, including dotted mapped IPv4, without I/O.
  if (!/^[0-9a-f:.]+$/.test(h)) return false
  let canonical: string
  try { canonical = new URL(`https://[${h}]/`).hostname.slice(1, -1) }
  catch { return false }
  const [left, right] = canonical.split('::')
  const head = left ? left.split(':').map(word => parseInt(word, 16)) : []
  const tail = right ? right.split(':').map(word => parseInt(word, 16)) : []
  const words = right === undefined ? head : [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail]
  if (words.every(word => word === 0) || (words.slice(0, 7).every(word => word === 0) && words[7] === 1)) return true
  if ((words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80) return true
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    return isPrivateProviderHost(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`)
  }
  return false
}

/** Hostname of an absolute URL, or null when the value is not parseable. Never throws. */
export function urlHostOf(value: string): string | null {
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

/**
 * The egress allowlist grammar, as SafeHttpClient enforces it at call time. Every
 * host decision (API-side base URL checks, plugin-side endpoint checks) must use
 * this so nothing is accepted on save that the runtime would then refuse.
 *
 * - `api.example.com` matches exactly that host.
 * - `*.example.com` matches any subdomain, never the apex `example.com`.
 * - `*-suffix.example.com` matches exactly one DNS label in front of the suffix
 *   (`us-central1-aiplatform.googleapis.com`), so `evil.com-suffix...` cannot pass.
 */
export function hostMatchesAllowlist(hostname: string, patterns: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return patterns.some(pattern => {
    const p = pattern.toLowerCase().trim()
    if (!p) return false
    if (p.startsWith('*.')) {
      const suffix = p.slice(1)
      return host.endsWith(suffix) && host.length > suffix.length
    }
    if (p.startsWith('*-')) {
      const suffix = p.slice(1)
      if (!host.endsWith(suffix) || host.length <= suffix.length) return false
      return !host.slice(0, host.length - suffix.length).includes('.')
    }
    return host === p
  })
}
