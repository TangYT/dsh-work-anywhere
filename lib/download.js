/**
 * dsh-work-anywhere · 大文件流式下载器
 *
 * 语义：经网络权限层（直连优先 → 代理回退 → huggingface.co 自动回退 hf-mirror.com）
 * 流式下载任意 http/https 文件到本地（.part → 完成改名），支持大小上限、sha256 校验、
 * 请求头透传（HF token 等）。零审批、大文件可用（GitHub release/codeload/raw、HF 模型）。
 */
import { createWriteStream } from 'node:fs'
import { rename, unlink, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { resolve, join, basename, dirname, sep } from 'node:path'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024 * 1024 // 10 GiB
const DEFAULT_TIMEOUT_MS = 900000 // 15 分钟
const MAX_TIMEOUT_MS = 3600000 // 1 小时

/** huggingface.co / hf.co → hf-mirror.com；非 HF 或已是镜像返回 null。 */
export function hfMirrorUrl(url) {
  const u = String(url ?? '')
  const m = /^https:\/\/(huggingface\.co|hf\.co)(\/.*)$/i.exec(u)
  if (!m) return null
  return 'https://hf-mirror.com' + m[2]
}

/** 生成候选 URL 列表：原地址（+ 可选 HF 镜像）。 */
export function candidateUrls(url, { mirror = false } = {}) {
  const out = [String(url)]
  if (mirror) {
    const m = hfMirrorUrl(url)
    if (m && m !== out[0]) out.push(m)
  }
  return out
}

const isWin = process.platform === 'win32'
function normPath(p) {
  const r = resolve(String(p ?? ''))
  const stripped = r.replace(/[\\/]+$/, '')
  return isWin ? stripped.toLowerCase() : stripped
}
function pathWithin(root, p) {
  const nr = normPath(root)
  const np = normPath(p)
  return np === nr || np.startsWith(nr + sep)
}

async function safeUnlink(fsImpl, path) {
  try { await fsImpl.unlink(path) } catch {}
}

/**
 * 下载器工厂。
 * @param netLayer {download(url, opts): Promise<Response>} 网络权限层（返回未消费响应）
 * @param fsImpl 可注入 fs（createWriteStream/rename/unlink/mkdir）
 * @param sessionRoot() 会话工作区根（dest 缺省落点）
 * @param cfg() 安全策略 {restrictPaths, allowedRoots}
 */
export function createDownloader({
  netLayer,
  fsImpl = null,
  sessionRoot = () => process.cwd(),
  cfg = () => ({}),
  log = null,
} = {}) {
  const f = fsImpl || { createWriteStream, rename, unlink, mkdir }
  if (!netLayer || typeof netLayer.download !== 'function') throw new Error('createDownloader: netLayer.download 不可用')

  async function download({ url, dest, timeoutMs, maxBytes, headers, sha256, mirror = true } = {}) {
    if (!/^https?:\/\//i.test(String(url ?? ''))) return { ok: false, error: '仅支持 http/https URL' }
    const caps = Math.max(1, Number(maxBytes) || DEFAULT_MAX_BYTES)

    // dest 解析 + 路径策略
    let target
    if (dest) {
      target = resolve(String(dest))
      const policy = cfg()
      if (policy.restrictPaths) {
        const roots = Array.isArray(policy.allowedRoots) && policy.allowedRoots.length > 0 ? policy.allowedRoots : [sessionRoot()]
        if (!roots.some((r) => pathWithin(r, target))) return { ok: false, error: 'dest 不允许（restrictPaths 策略）：' + target }
      }
    } else {
      let name = 'download.bin'
      try {
        const p = new URL(String(url)).pathname
        name = basename(p) || 'download.bin'
      } catch {}
      target = join(sessionRoot(), name)
    }

    const effTimeout = Math.min(Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS)
    const signal = AbortSignal.timeout(effTimeout)
    const expectHash = sha256 ? String(sha256).toLowerCase() : null
    const urls = candidateUrls(url, { mirror })
    let lastErr = 'no candidate url'

    for (const cand of urls) {
      let res
      try {
        res = await Promise.race([
          netLayer.download(cand, { headers, signal }),
          new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('download timeout: ' + effTimeout + 'ms')), { once: true })),
        ])
      } catch (e) {
        lastErr = String(e && e.message || e)
        if (signal.aborted) break
        continue
      }
      if (res.status >= 400) {
        lastErr = 'HTTP ' + res.status + ' (' + cand + ')'
        continue
      }
      const cl = Number(res.headers?.get?.('content-length'))
      if (Number.isFinite(cl) && cl > caps) {
        lastErr = 'content-length ' + cl + ' 超过大小上限 ' + caps + ' 字节'
        continue
      }

      const part = target + '.part'
      try {
        await f.mkdir(dirname(target), { recursive: true })
      } catch (e) {
        return { ok: false, error: 'mkdir 失败: ' + String(e && e.message || e) }
      }

      let bytes = 0
      let hash = null
      let hashHex = null
      let streamOk = false
      try {
        await new Promise((resolveW, rejectW) => {
          const ws = f.createWriteStream(part)
          hash = createHash('sha256')
          let settled = false
          const finishOk = () => { if (!settled) { settled = true; resolveW() } }
          const fail = (e) => {
            if (settled) return
            settled = true
            try { ws.destroy() } catch {}
            rejectW(e)
          }
          ws.on('error', fail)
          ws.on('finish', finishOk)
          if (res.body) {
            const source = Readable.fromWeb(res.body)
            source.on('data', (chunk) => {
              bytes += chunk.length
              hash.update(chunk)
              if (bytes > caps) { source.destroy(new Error('超过大小上限 ' + caps + ' 字节')); return }
            })
            source.on('error', fail)
            source.pipe(ws)
          } else {
            ws.end()
          }
        })
        streamOk = true
        hashHex = hash.digest('hex')
      } catch (e) {
        lastErr = String(e && e.message || e)
        await safeUnlink(f, part)
        continue
      }
      if (!streamOk) continue

      if (expectHash) {
        if (hashHex !== expectHash) {
          lastErr = 'sha256 不匹配: got ' + hashHex + ' want ' + expectHash
          await safeUnlink(f, part)
          continue
        }
      }
      try {
        await f.rename(part, target)
      } catch (e) {
        lastErr = 'rename 失败: ' + String(e && e.message || e)
        await safeUnlink(f, part)
        continue
      }
      if (log) log('download ok: ' + cand + ' → ' + target + ' (' + bytes + ' bytes)')
      return { ok: true, path: target, bytes, sha256: hashHex, finalUrl: cand }
    }
    return { ok: false, error: lastErr }
  }

  return { download }
}
