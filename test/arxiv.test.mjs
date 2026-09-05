/**
 * lib/arxiv.js 的 TDD 测试：arXiv 编号/链接解析、HTML 版 URL 构造、正文剥离、
 * 阅读器降级链（版本回退 / 无 HTML 建议 PDF / 截断）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseArxivId,
  arxivHtmlUrl,
  arxivPdfUrl,
  extractTitle,
  stripHtml,
  createArxivReader,
} from '../lib/arxiv.js'

// ---------- parseArxivId ----------

test('parseArxivId: 裸编号（无版本）', () => {
  assert.deepEqual(parseArxivId('2601.01685'), { ok: true, id: '2601.01685', version: null })
})

test('parseArxivId: 裸编号带版本', () => {
  assert.deepEqual(parseArxivId('2601.01685v2'), { ok: true, id: '2601.01685', version: 2 })
})

test('parseArxivId: arXiv: 前缀', () => {
  assert.deepEqual(parseArxivId('arXiv:2601.01685v3'), { ok: true, id: '2601.01685', version: 3 })
})

test('parseArxivId: abs 链接（含版本）', () => {
  assert.deepEqual(parseArxivId('https://arxiv.org/abs/2601.01685v2'), { ok: true, id: '2601.01685', version: 2 })
})

test('parseArxivId: pdf 链接', () => {
  assert.deepEqual(parseArxivId('https://arxiv.org/pdf/2601.01685'), { ok: true, id: '2601.01685', version: null })
})

test('parseArxivId: html 链接', () => {
  assert.deepEqual(parseArxivId('https://arxiv.org/html/2601.01685v2'), { ok: true, id: '2601.01685', version: 2 })
})

test('parseArxivId: 旧式编号', () => {
  assert.deepEqual(parseArxivId('hep-th/9901001'), { ok: true, id: 'hep-th/9901001', version: null })
  assert.deepEqual(parseArxivId('cond-mat.soft/0701010v2'), { ok: true, id: 'cond-mat.soft/0701010', version: 2 })
})

test('parseArxivId: 非法输入报错', () => {
  assert.equal(parseArxivId('https://example.com/2601.01685').ok, false)
  assert.equal(parseArxivId('hello world').ok, false)
  assert.equal(parseArxivId('').ok, false)
})

// ---------- arxivHtmlUrl / arxivPdfUrl ----------

test('arxivHtmlUrl: 无版本不带 v 后缀', () => {
  assert.equal(arxivHtmlUrl({ id: '2601.01685', version: null }), 'https://arxiv.org/html/2601.01685')
})

test('arxivHtmlUrl: 带版本带 v 后缀', () => {
  assert.equal(arxivHtmlUrl({ id: '2601.01685', version: 2 }), 'https://arxiv.org/html/2601.01685v2')
})

test('arxivPdfUrl: 生成 PDF 建议链接', () => {
  assert.equal(arxivPdfUrl('2601.01685'), 'https://arxiv.org/pdf/2601.01685')
})

// ---------- extractTitle / stripHtml ----------

const PAPER_HTML = [
  '<html><head><title>[2601.01685] Test Paper Title</title>',
  '<script>var x = 1;</script><style>body{color:red}</style></head><body>',
  '<div><h1>Section One</h1>',
  '<p>Hello &amp; welcome to <em>arXiv</em>.</p>',
  '<p>Equation <math alttext="E=mc^2"><mjx-container>junk</mjx-container></math> inline.</p>',
  '<ul><li>item one</li><li>item two</li></ul>',
  '<table><tr><td>a</td><td>b</td></tr></table>',
  '<p>line<br>break</p>',
  '</div></body></html>',
].join('\n')

test('extractTitle: 去掉 [编号] 前缀', () => {
  assert.equal(extractTitle(PAPER_HTML), 'Test Paper Title')
})

test('stripHtml: 去掉 script/style 块与所有标签', () => {
  const text = stripHtml(PAPER_HTML)
  assert.doesNotMatch(text, /var x|color:red|<\/?[a-z][^>]*>/i)
})

test('stripHtml: 实体解码', () => {
  assert.match(stripHtml(PAPER_HTML), /Hello & welcome/)
})

test('stripHtml: 块级元素转行、行内保留', () => {
  const text = stripHtml(PAPER_HTML)
  assert.match(text, /Section One\n/)
  assert.match(text, /item one\nitem two/)
  assert.match(text, /a\nb/)
  assert.match(text, /line\nbreak/)
})

test('stripHtml: math alttext 中的 LaTeX 公式保留', () => {
  assert.match(stripHtml(PAPER_HTML), /E=mc\^2/)
})

test('stripHtml: 连续空行折叠', () => {
  const text = stripHtml('<p>a</p>\n\n\n<p>b</p>')
  assert.doesNotMatch(text, /\n{3,}/)
})

test('stripHtml: 移除 dialog 弹窗块（报告问题表单等页面 chrome）', () => {
  const html = '<dialog class="modal-content"><h5>Report GitHub Issue</h5><textarea>Content selection saved.</textarea></dialog><p>real body</p>'
  const text = stripHtml(html)
  assert.match(text, /real body/)
  assert.doesNotMatch(text, /Report GitHub Issue|Content selection/)
})

test('stripHtml: 移除 header/nav/footer 页面 chrome', () => {
  const html = '<header>arXiv is now an independent nonprofit!</header><nav>login</nav><footer>© arXiv</footer><p>paper body</p>'
  const text = stripHtml(html)
  assert.match(text, /paper body/)
  assert.doesNotMatch(text, /nonprofit|login|©/)
})

// ---------- createArxivReader ----------

function fakeNet(routes) {
  const calls = []
  return {
    calls,
    async download(url, opts) {
      calls.push(url)
      const hit = routes.find((r) => (r.match instanceof RegExp ? r.match.test(url) : r.match === url))
      if (!hit) throw new Error('no route for ' + url)
      if (hit.throw) throw hit.throw
      return hit.response()
    },
  }
}

test('reader: 成功返回标题与正文（首选带版本 URL）', async () => {
  const net = fakeNet([{ match: 'https://arxiv.org/html/2601.01685v2', response: () => new Response(PAPER_HTML) }])
  const reader = createArxivReader({ netLayer: net })
  const r = await reader.read({ url: 'https://arxiv.org/abs/2601.01685v2' })
  assert.equal(r.ok, true)
  assert.equal(r.title, 'Test Paper Title')
  assert.match(r.text, /Section One/)
  assert.equal(r.url, 'https://arxiv.org/html/2601.01685v2')
  assert.equal(r.truncated, false)
})

test('reader: 带版本 404 时回退最新版', async () => {
  const net = fakeNet([
    { match: 'https://arxiv.org/html/2601.01685v2', response: () => new Response('nope', { status: 404 }) },
    { match: 'https://arxiv.org/html/2601.01685', response: () => new Response(PAPER_HTML) },
  ])
  const reader = createArxivReader({ netLayer: net })
  const r = await reader.read({ url: '2601.01685v2' })
  assert.equal(r.ok, true)
  assert.equal(r.url, 'https://arxiv.org/html/2601.01685')
  assert.deepEqual(net.calls, ['https://arxiv.org/html/2601.01685v2', 'https://arxiv.org/html/2601.01685'])
})

test('reader: 全部 404（老论文无 HTML）时给出 PDF 下载建议', async () => {
  const net = fakeNet([
    { match: /arxiv\.org\/html\//, response: () => new Response('nope', { status: 404 }) },
  ])
  const reader = createArxivReader({ netLayer: net })
  const r = await reader.read({ url: 'hep-th/9901001' })
  assert.equal(r.ok, false)
  assert.match(r.error, /dwa_net_download/)
  assert.match(r.error, /https:\/\/arxiv\.org\/pdf\/hep-th\/9901001/)
})

test('reader: 网络失败返回错误', async () => {
  const net = fakeNet([{ match: /./, throw: new TypeError('fetch failed') }])
  const reader = createArxivReader({ netLayer: net })
  const r = await reader.read({ url: '2601.01685' })
  assert.equal(r.ok, false)
  assert.match(r.error, /fetch failed/)
})

test('reader: 非法输入报错且不发请求', async () => {
  const net = fakeNet([])
  const reader = createArxivReader({ netLayer: net })
  const r = await reader.read({ url: 'not-a-paper' })
  assert.equal(r.ok, false)
  assert.match(r.error, /无法解析/)
  assert.equal(net.calls.length, 0)
})

test('reader: 超长正文按 maxChars 截断并标注', async () => {
  const longBody = '<html><head><title>[2601.01685] Long</title></head><body>' + 'x'.repeat(5000) + '</body></html>'
  const net = fakeNet([{ match: /./, response: () => new Response(longBody) }])
  const reader = createArxivReader({ netLayer: net })
  const r = await reader.read({ url: '2601.01685', maxChars: 1000 })
  assert.equal(r.ok, true)
  assert.equal(r.truncated, true)
  assert.ok(r.text.length <= 1000 + 64)
  assert.match(r.note, /截断/)
})

test('reader: 截断统计的是正文纯文本长度而非 HTML 长度', async () => {
  const body = '<html><head><title>[2601.01685] T</title></head><body>' + '<p>hello</p>'.repeat(3000) + '</body></html>'
  const net = fakeNet([{ match: /./, response: () => new Response(body) }])
  const reader = createArxivReader({ netLayer: net })
  const r = await reader.read({ url: '2601.01685', maxChars: 100 })
  assert.equal(r.truncated, true)
  assert.ok(r.text.length <= 100 + 64, 'text length ' + r.text.length)
})
