/**
 * dsh-work-anywhere · 网络权限层
 *
 * 语义：在 Workspace Write 文件权限之外放行网络访问——**直连优先**；直连失败时
 * 自动扫描本机可用代理（环境变量 → Windows 系统代理 → 常见 Clash/代理端口）并回退，
 * 成功命中的代理缓存 10 分钟（过期或失效后重新扫描）。
 *
 * 依赖：undici（HTTP CONNECT / SOCKS 代理支持，纯 JS）。
 */
import { spawnSync } from 'node:child_process'

export const COMMON_PROXY_CANDIDATES = [
  'http://127.0.0.1:7890',
  'http://127.0.0.1:7897',
  'http://127.0.0.1:7891',
  'http://127.0.0.1:7892',
  'http://127.0.0.1:7898',
  'http://127.0.0.1:7899',
  'http://127.0.0.1:10808',
  'http://127.0.0.1:10809',
  'http://127.0.0.1:8888',
  'http://127.0.0.1:8080',
  'socks5://127.0.0.1:1080',
]

/** 环境变量中的代理（ALL_PROXY > HTTPS_PROXY > HTTP_PROXY，大小写兼容）。 */
export function envProxyCandidates(env = process.env) {
  const out = []
  for (const k of ['ALL_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY']) {
    const v = env[k] || env[k.toLowerCase()]
    if (v && /^[a-z]+:\/\//i.test(v) && !out.includes(v)) out.push(v)
  }
  return out
}

/** Windows 系统代理（HKCU Internet Settings，含 http=…;https=… 分协议写法）。 */
export function parseWindowsSystemProxy() {
  if (process.platform !== 'win32') return null
  try {
    const out = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'], { encoding: 'utf8', timeout: 3000 })
    if (out.status !== 0) return null
    const m = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(out.stdout || '')
    if (!m) return null
    let v = m[1]
    if (v.includes('=')) {
      const https = /https=([^;]+)/i.exec(v)
      if (https) v = https[1]
      else {
        const first = v.split(';')[0].split('=')
        v = first.length > 1 ? first[1] : first[0]
      }
    }
    if (!/^[a-z]+:\/\//i.test(v)) v = 'http://' + v
    return v
  } catch { return null }
}

/** 收集候选代理（去重、保持优先级）：显式配置 → 环境变量 → 系统代理 → 常见端口。 */
export function collectProxyCandidates({ explicit = null, env = process.env, systemProxyFn = parseWindowsSystemProxy } = {}) {
  const out = []
  if (explicit) out.push(explicit)
  for (const c of envProxyCandidates(env)) out.push(c)
  const sys = (() => { try { return systemProxyFn() } catch { return null } })()
  if (sys && !out.includes(sys)) out.push(sys)
  for (const c of COMMON_PROXY_CANDIDATES) if (!out.includes(c)) out.push(c)
  return out
}

/**
 * 网络层工厂（可注入依赖以便测试）。
 * @param fetchImpl 直连 fetch（默认 global fetch）
 * @param proxyFetchImpl(url, proxyUrl, opts) 经代理抓取（默认 undici ProxyAgent）
 * @param candidates 候选代理列表（缺省自动收集）
 * @param proxyTtlMs 命中代理的缓存时长（默认 10 分钟）
 * @param proxyAttemptMs 单候选尝试超时（默认 5 秒）
 * @param scanLimit 一次扫描最多尝试的候选数（默认 6）
 * @param now/log 时钟与日志（测试注入）
 */
export function createNetLayer({
  fetchImpl = (url, opts) => fetch(url, opts),
  proxyFetchImpl = null,
  candidates = null,
  proxyTtlMs = 600000,
  proxyAttemptMs = 5000,
  scanLimit = 6,
  now = Date.now,
  log = null,
} = {}) {
  let cachedProxy = null
  let cachedAt = 0

  /**
   * 经指定代理抓取。
   * @param mode 'fetch'：整个尝试受 proxyAttemptMs 掐断；'download'：仅连接建立受
   *   connectTimeout 限制，body 流式传输由调用方 signal 控制（大文件不被打断）。
   */
  async function viaProxy(proxyUrl, url, opts, mode = 'fetch') {
    try {
      if (proxyFetchImpl) return await proxyFetchImpl(url, proxyUrl, opts, proxyAttemptMs, mode)
      let undici
      try { undici = await import('undici') } catch { return null }
      let dispatcher
      let signal
      if (mode === 'download') {
        dispatcher = new undici.ProxyAgent({ uri: proxyUrl, connectTimeout: proxyAttemptMs })
        signal = opts && opts.signal ? opts.signal : undefined
      } else {
        dispatcher = new undici.ProxyAgent(proxyUrl)
        const attempt = AbortSignal.timeout(proxyAttemptMs)
        const prev = opts && opts.signal ? opts.signal : undefined
        signal = prev ? AbortSignal.any([prev, attempt]) : attempt
      }
      const merged = { ...opts, dispatcher }
      if (signal) merged.signal = signal
      return await undici.fetch(url, merged)
    } catch { return null }
  }

  async function fetchViaPolicy(url, opts = {}, mode = 'fetch') {
    // 1) 直连优先
    try {
      return await fetchImpl(url, opts)
    } catch (directError) {
      // 2) 命中缓存代理
      if (cachedProxy && now() - cachedAt < proxyTtlMs) {
        const r = await viaProxy(cachedProxy, url, opts, mode)
        if (r) return r
        cachedProxy = null
      }
      // 3) 自动扫描本地代理（并行竞速，先通先用）
      const list = (candidates !== null ? candidates : collectProxyCandidates()).slice(0, scanLimit)
      if (list.length) {
        const results = await Promise.all(list.map(async (p) => {
          const r = await viaProxy(p, url, opts, mode)
          return r ? { proxy: p, response: r } : null
        }))
        const win = results.find((x) => x !== null)
        if (win) {
          cachedProxy = win.proxy
          cachedAt = now()
          if (log) log('net: direct failed, proxy discovered: ' + win.proxy + (mode === 'download' ? ' (download)' : ''))
          return win.response
        }
      }
      throw directError
    }
  }

  return {
    fetch: (url, opts) => fetchViaPolicy(url, opts, 'fetch'),
    /** 流式下载模式：返回未消费的 Response，代理尝试只限连接超时，body 由调用方 signal 控制。 */
    download: (url, opts) => fetchViaPolicy(url, opts, 'download'),
    discoveredProxy: () => cachedProxy,
    resetCache: () => { cachedProxy = null; cachedAt = 0 },
  }
}
