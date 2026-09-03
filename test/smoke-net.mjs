// dsh-work-anywhere 网络权限层测试：直连优先 / 失败回退代理（扫描+缓存）/ 候选收集 / 全失败抛直连错误
import { createNetLayer, collectProxyCandidates, envProxyCandidates } from '../lib/net.js'

let failed = 0
const ok = (label, cond, extra) => {
  if (cond) console.log('PASS ' + label)
  else { failed++; console.error('FAIL ' + label + (extra !== undefined ? ' → ' + extra : '')) }
}

// ---------- 候选收集 ----------
{
  const c = collectProxyCandidates({
    explicit: 'http://127.0.0.1:9999',
    env: { ALL_PROXY: 'http://127.0.0.1:7897', https_proxy: 'http://127.0.0.1:7898' },
    systemProxyFn: () => 'http://127.0.0.1:7890',
  })
  ok('候选顺序：显式配置优先', c[0] === 'http://127.0.0.1:9999', c.join(','))
  ok('候选含环境变量（大小写兼容）', c.includes('http://127.0.0.1:7897') && c.includes('http://127.0.0.1:7898'))
  ok('候选含系统代理', c.includes('http://127.0.0.1:7890'))
  ok('候选去重', new Set(c).size === c.length)
  const c2 = collectProxyCandidates({ explicit: null, env: {}, systemProxyFn: () => null })
  ok('无任何配置时仍有常见 Clash 端口候选', c2.length > 0 && c2.includes('http://127.0.0.1:7897'), c2.join(','))
}
{
  const e = envProxyCandidates({ HTTP_PROXY: 'http://127.0.0.1:7890', all_proxy: 'http://127.0.0.1:7899' })
  ok('env 解析大小写兼容', e.includes('http://127.0.0.1:7890') && e.includes('http://127.0.0.1:7899'), e.join(','))
}

// ---------- 直连成功 → 不碰代理 ----------
{
  const calls = []
  const net = createNetLayer({
    fetchImpl: async () => { calls.push('direct'); return { status: 200, text: async () => 'ok' } },
    proxyFetchImpl: async () => { calls.push('proxy'); return { status: 200 } },
    candidates: ['http://p'],
  })
  const r = await net.fetch('https://example.com/x')
  ok('直连成功返回响应', r.status === 200)
  ok('直连成功不扫代理', calls.length === 1 && calls[0] === 'direct', calls.join(','))
  ok('无命中代理缓存', net.discoveredProxy() === null)
}

// ---------- 直连失败 → 并行扫描命中并缓存；二次请求直接用缓存 ----------
{
  const calls = []
  const net = createNetLayer({
    fetchImpl: async () => { const e = new Error('network down'); e.cause = { code: 'ECONNREFUSED' }; throw e },
    proxyFetchImpl: async (u, p) => { calls.push(p); if (p === 'http://bad') throw new Error('proxy dead'); return { status: 200, text: async () => 'via proxy' } },
    candidates: ['http://bad', 'http://good'],
    proxyTtlMs: 60000,
    now: () => 0,
  })
  const r = await net.fetch('https://example.com/y')
  ok('直连失败回退代理成功', r.status === 200 && (await r.text()) === 'via proxy')
  ok('命中代理被缓存', net.discoveredProxy() === 'http://good', String(net.discoveredProxy()))
  const idx = calls.indexOf('http://good')
  const r2 = await net.fetch('https://example.com/z')
  ok('二次请求走缓存代理', r2.status === 200)
  ok('二次请求不重扫坏代理', !calls.slice(idx + 1).includes('http://bad'), calls.join(','))
}

// ---------- 缓存过期 → 重新扫描 ----------
{
  let t = 0
  let scans = 0
  const net = createNetLayer({
    fetchImpl: async () => { throw new Error('down') },
    proxyFetchImpl: async (u, p) => { scans++; return { status: 200 } },
    candidates: ['http://p1'],
    proxyTtlMs: 1000,
    now: () => t,
  })
  await net.fetch('https://x')
  t = 2000
  const r = await net.fetch('https://x')
  ok('缓存过期后重新扫描仍可用', r.status === 200 && scans === 2, 'scans=' + scans)
}

// ---------- 全部失败 → 抛直连原始错误 ----------
{
  const boom = new Error('direct boom')
  const net = createNetLayer({
    fetchImpl: async () => { throw boom },
    proxyFetchImpl: async () => { throw new Error('no proxy') },
    candidates: ['http://p1'],
  })
  let threw = null
  try { await net.fetch('https://x') } catch (e) { threw = e }
  ok('全失败抛直连原始错误', threw === boom, threw && threw.message)
}

if (failed) { console.error('NET CASES FAILED: ' + failed); process.exit(1) }
console.log('NET CASES OK')
process.exit(0)
