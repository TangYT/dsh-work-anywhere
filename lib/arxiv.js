/**
 * dsh-work-anywhere · arXiv 论文阅读器
 *
 * 语义：arXiv 自 2023-12 起为每篇论文提供 HTML 版全文（https://arxiv.org/html/<id>）。
 * 本模块把「链接/编号 → HTML 全文 → 纯文本（公式保留 LaTeX）」做成一条工具链：
 * 编号解析 → HTML 版抓取（经网络权限层直连→代理回退）→ 服务端剥离标签返回可读正文；
 * 带版本号 404 自动降级最新版；老论文无 HTML 时给出 PDF 下载建议。
 */

const NEW_ID = /^(\d{4}\.\d{4,5})(v(\d{1,3}))?$/i
const OLD_ID = /^([a-z-]+(?:\.[A-Z]{1,6})?\/\d{7})(v(\d{1,3}))?$/i

/**
 * 解析 arXiv 编号或链接。
 * 支持：裸编号（2601.01685 / 2601.01685v2 / hep-th/9901001）、arXiv: 前缀、
 * arxiv.org 的 /abs/ /pdf/ /html/ 链接。
 * @returns {{ok:true, id:string, version:number|null}|{ok:false, error:string}}
 */
export function parseArxivId(input) {
  let s = String(input ?? '').trim()
  if (!s) return { ok: false, error: '无法解析 arXiv 编号/链接：输入为空' }
  s = s.replace(/^arxiv:\s*/i, '')
  if (/^https?:\/\//i.test(s) || /^arxiv\.org\//i.test(s)) {
    let u
    try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s) } catch { return { ok: false, error: '无法解析 arXiv 编号/链接: ' + String(input).slice(0, 120) } }
    const host = (u.hostname || '').toLowerCase()
    if (host !== 'arxiv.org' && !host.endsWith('.arxiv.org')) return { ok: false, error: '不是 arxiv.org 链接: ' + host }
    const m = /^\/(abs|pdf|html|format)\/([^/?#]+)/i.exec(u.pathname || '')
    if (!m) return { ok: false, error: '无法从链接中解析 arXiv 编号: ' + String(input).slice(0, 120) }
    s = decodeURIComponent(m[2])
  }
  const n = NEW_ID.exec(s)
  if (n) return { ok: true, id: n[1], version: n[3] ? parseInt(n[3], 10) : null }
  const o = OLD_ID.exec(s)
  if (o) return { ok: true, id: o[1], version: o[3] ? parseInt(o[3], 10) : null }
  return { ok: false, error: '无法解析 arXiv 编号/链接: ' + String(input).slice(0, 120) }
}

/** HTML 版 URL（version 为空 = 最新版）。 */
export function arxivHtmlUrl({ id, version }) {
  return 'https://arxiv.org/html/' + id + (version ? 'v' + version : '')
}

/** PDF 直链（老论文无 HTML 时建议下载用）。 */
export function arxivPdfUrl(id) {
  return 'https://arxiv.org/pdf/' + id
}

/** 从 HTML 提取 <title>（去掉 arXiv 的 [编号] 前缀）。 */
export function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''))
  if (!m) return ''
  return String(m[1]).trim().replace(/^\[[^\]]*\]\s*/, '').trim()
}

/**
 * 把论文 HTML 剥离为可读纯文本：
 * 去掉 script/style/title 块；<math alttext="…"> 保留为 $LaTeX$；块级元素转行；
 * 实体解码；空白归一。
 */
export function stripHtml(html) {
  let s = String(html ?? '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<title[^>]*>[\s\S]*?<\/title>/gi, ' ')
  // 页面 chrome：报告问题弹窗 / 页眉 / 导航 / 页脚
  s = s.replace(/<dialog[\s\S]*?<\/dialog>/gi, ' ')
  s = s.replace(/<header[\s\S]*?<\/header>/gi, ' ')
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
  s = s.replace(/<math\b([^>]*)>[\s\S]*?<\/math>/gi, (_m, attrs) => {
    const alt = /alttext="([^"]*)"/.exec(attrs)
    return alt ? ' $' + alt[1] + '$ ' : ' '
  })
  s = s.replace(/<\/(?:p|div|h[1-6]|section|li|tr|td|th|blockquote|ul|ol|table|figure|caption)>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)) } catch { return ' ' } })
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)) } catch { return ' ' } })
  s = s.replace(/&nbsp;/gi, ' ')
  s = s.replace(/&amp;/gi, '&')
  s = s.replace(/&lt;/gi, '<')
  s = s.replace(/&gt;/gi, '>')
  s = s.replace(/&quot;/gi, '"')
  s = s.replace(/&#39;|&apos;/gi, "'")
  s = s.replace(/&ldquo;|&rdquo;/gi, '"')
  s = s.replace(/&lsquo;|&rsquo;/gi, "'")
  s = s.replace(/&mdash;/gi, '—').replace(/&ndash;/gi, '–').replace(/&hellip;/gi, '…')
  s = s.replace(/&[a-z]+;/gi, ' ')
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.replace(/ *\n */g, '\n')
  return s.trim()
}

/**
 * 阅读器工厂。
 * @param netLayer {download(url, opts): Promise<Response>} 网络权限层（返回未消费响应）
 */
export function createArxivReader({ netLayer, log = null } = {}) {
  const DEFAULT_MAX_CHARS = 100000
  const MAX_CHARS_CAP = 400000
  if (!netLayer || typeof netLayer.download !== 'function') throw new Error('createArxivReader: netLayer.download 不可用')

  return {
    async read({ url, maxChars } = {}) {
      const parsed = parseArxivId(url)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      const cap = Math.min(Math.max(1, Number(maxChars) || DEFAULT_MAX_CHARS), MAX_CHARS_CAP)
      const candidates = [arxivHtmlUrl(parsed)]
      if (parsed.version !== null) candidates.push(arxivHtmlUrl({ id: parsed.id, version: null }))

      let lastErr = ''
      let saw404 = false
      for (const cand of candidates) {
        let res
        try {
          res = await netLayer.download(cand, { signal: AbortSignal.timeout(90000) })
        } catch (e) {
          lastErr = String(e && e.message || e)
          if (/timeout|abort/i.test(lastErr)) lastErr = '抓取超时: ' + cand
          continue
        }
        if (res.status === 404) { saw404 = true; continue }
        if (res.status >= 400) { lastErr = 'HTTP ' + res.status + ' (' + cand + ')'; continue }
        let html
        try { html = await res.text() } catch (e) { lastErr = String(e && e.message || e); continue }
        const title = extractTitle(html)
        const text = stripHtml(html)
        if (log) log('arxiv read ok: ' + cand + ' (' + text.length + ' chars)')
        if (text.length > cap) {
          return {
            ok: true, title, url: cand, text: text.slice(0, cap), truncated: true,
            note: '…（正文已截断：原 ' + text.length + ' 字符；可调大 maxChars，最大 ' + MAX_CHARS_CAP + '）',
          }
        }
        return { ok: true, title, url: cand, text, truncated: false }
      }
      if (saw404) {
        return { ok: false, error: '该论文没有 HTML 版本（arXiv 2023-12 起才提供 HTML）。可改用 dwa_net_download 下载 PDF：' + arxivPdfUrl(parsed.id) }
      }
      return { ok: false, error: lastErr || '抓取失败' }
    },
  }
}
