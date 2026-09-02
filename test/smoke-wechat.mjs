// dsh-wechat-channel 冒烟测试：
// 假 ctx 加载宿主插件 → 校验注入/路由/工具 schema/事件处理器/回环守卫，不触网。
// 状态目录指向临时目录，绝不读取真实 ~/.dsh/wechat-channel/state.json。
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateDir = mkdtempSync(join(tmpdir(), 'dsh-wc-smoke-'))
process.env.DSH_WECHAT_STATE_DIR = stateDir
// 预置一个「映射会话已归档」的对端（门控用例）
writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
  version: 2,
  connected: null,
  cursor: '',
  peers: { 'peer-arch': { currentProject: process.cwd(), projectSessions: { [process.cwd()]: 'session-archived' } } },
}, null, 2))
const { apply, name, inject } = await import('../lib/wechat-channel.js')

const routes = []
const toolDefs = []
const listeners = {}
const disposers = []
const createdAgents = []
const resumedSessions = []
const liveAgents = new Map()

function fakeAgent(id) {
  const a = {
    id,
    session: { id },
    followup(msg) { a.followups.push(msg) },
    followups: [],
  }
  return a
}

const fakeCtx = {
  webServer: {
    register(def) {
      routes.push(def)
      return () => {}
    },
  },
  agents: {
    async create(opts) {
      createdAgents.push(opts)
      const a = fakeAgent(opts.sessionId)
      liveAgents.set(opts.sessionId, a)
      return { agent: a, dispose: async () => liveAgents.delete(opts.sessionId) }
    },
    async resume(opts) {
      resumedSessions.push(opts)
      const a = fakeAgent(opts.resumeSessionId)
      liveAgents.set(opts.resumeSessionId, a)
      return { agent: a, dispose: async () => liveAgents.delete(opts.resumeSessionId) }
    },
    get(id) { return liveAgents.get(id) },
    currentInitiator() { return undefined },
  },
  workspaceRegistry: {
    list() { return [{ id: 'w1', path: process.cwd(), title: 'test-workspace' }] },
    archivedSessionIds: ['session-archived'], // 门控用例：该会话已归档
  },
  tools: {
    register(def) { toolDefs.push(def); return () => {} },
  },
  on(name, fn) {
    listeners[name] = fn
    return () => { delete listeners[name] }
  },
  effect(fn) {
    disposers.push(fn)
    return () => {}
  },
}

apply(fakeCtx)

// 1. 插件形态
console.log('plugin name =', name)
console.log('inject      =', JSON.stringify(inject))

// 2. 路由
const paths = routes.map((r) => r.path)
console.log('routes      =', paths.join(', '))
for (const p of ['/api/dsh-wechat-channel/status', '/api/dsh-wechat-channel/login', '/api/dsh-wechat-channel/verify', '/api/dsh-wechat-channel/logout', '/api/dsh-wechat-channel/switch']) {
  if (!paths.includes(p)) throw new Error('缺少路由: ' + p)
}

// 3. 工具 schema（根必须 type:object，required 在根数组）
console.log('tools       =', toolDefs.length)
for (const t of toolDefs) {
  const root = t.parameters
  if (!root || root.type !== 'object' || !root.properties) throw new Error(t.name + ' schema 根不是 object')
  if (!Array.isArray(root.required)) throw new Error(t.name + ' schema 缺 required 数组')
  if (!t.output || !t.output.schema || typeof t.output.render !== 'function') throw new Error(t.name + ' 缺 output { schema, render }')
  console.log('  ok', t.name, 'params:', Object.keys(root.properties).join(','), 'required:', root.required.join(','), 'output:', JSON.stringify(t.output.schema))
}

// 4. session/event 处理器：assistant/message 缓冲 → turn/end 触发（未连接时不发送，仅验证不抛错）
const sessionEvent = listeners['session/event']
if (typeof sessionEvent !== 'function') throw new Error('缺少 session/event 监听')
sessionEvent({ id: 'sid-1' }, { type: 'assistant/message', seq: 1, time: Date.now(), data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'hello from agent' }] } } })
sessionEvent({ id: 'sid-1' }, { type: 'turn/end', seq: 2, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
console.log('  ok session/event 缓冲与 turn/end 处理无异常')

// 5. 状态路由（回环放行）
async function callRoute(path, method, body) {
  const def = routes.find((r) => r.path === path)
  if (!def) throw new Error('路由未注册: ' + path)
  let captured = ''
  const res = {
    statusCode: 0,
    setHeader() {},
    end(b) { captured = typeof b === 'string' ? b : JSON.stringify(b) },
  }
  let reqBody = body === undefined ? '' : JSON.stringify(body)
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    method,
    on(ev, fn) {
      if (ev === 'data' && reqBody) { fn(Buffer.from(reqBody)); reqBody = '' }
      if (ev === 'end') queueMicrotask(fn)
      if (ev === 'error') {}
    },
  }
  await def.handler(req, res)
  return { code: res.statusCode, body: JSON.parse(captured || '{}') }
}
{
  const r = await callRoute('/api/dsh-wechat-channel/status', 'GET')
  if (r.code !== 200 || r.body.ok !== true || r.body.connected !== null) throw new Error('status 路由异常: ' + JSON.stringify(r.body).slice(0, 200))
  console.log('  ok status 路由 →', JSON.stringify({ connected: r.body.connected, projects: (r.body.projects || []).map((p) => p.title) }))
}
{
  const r = await callRoute('/api/dsh-wechat-channel/logout', 'POST', {})
  if (r.code !== 200 || r.body.ok !== true) throw new Error('logout 路由异常')
  console.log('  ok logout 路由')
}
{
  const r = await callRoute('/api/dsh-wechat-channel/switch', 'POST', { peerId: 'nope', project: 'x' })
  if (r.code !== 400) throw new Error('switch 未知对端应 400，得到 ' + r.code)
  console.log('  ok switch 未知对端 → 400')
}
{
  // 门控（硬拒绝）：对端映射的会话已归档 → 400 且不恢复
  const r = await callRoute('/api/dsh-wechat-channel/switch', 'POST', { peerId: 'peer-arch', project: process.cwd() })
  if (r.code !== 400 || !String(r.body.error).includes('已归档')) throw new Error('switch 归档会话应 400 已归档，得到 ' + r.code + ' ' + JSON.stringify(r.body))
  if (resumedSessions.some((x) => x.resumeSessionId === 'session-archived')) throw new Error('归档会话不应被恢复')
  console.log('  ok switch 已归档会话 → 400 门控（不恢复）')
}

// 6. 卸载清理
for (const d of disposers) { try { d() } catch (e) { console.log('disposer warn:', e && e.message) } }
console.log('  ok 卸载清理执行完毕')

console.log('SMOKE OK')
