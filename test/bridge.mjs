// dsh-wechat-channel 桥接全链路测试（离线）：
// stub 全局 fetch 模拟 iLink API（getupdates/sendmessage/notifystart），
// 预置已连接状态 → 验证：入站消息→自动建会话(cwd=项目)→followup、
// 会话复用、/switch 命令、turn 结束推回微信、context_token 回显、卸载清理。
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateDir = mkdtempSync(join(tmpdir(), 'dsh-wc-bridge-'))
process.env.DSH_WECHAT_STATE_DIR = stateDir

// ---------- iLink API stub ----------
const inbound = []
const outbound = []
function resp(json) {
  return { ok: true, status: 200, text: async () => JSON.stringify(json) }
}
globalThis.fetch = async (url, opts = {}) => {
  // 宏任务让步：防止全微任务链饿死事件循环（真实网络天然有延迟）
  await new Promise((r) => setTimeout(r, 5))
  const u = String(url)
  const body = opts.body ? JSON.parse(opts.body) : {}
  if (u.includes('notifystart')) return resp({ ret: 0 })
  if (u.includes('notifystop')) return resp({ ret: 0 })
  if (u.includes('sendmessage')) {
    outbound.push(body.msg)
    return resp({ ret: 0 })
  }
  if (u.includes('getupdates')) {
    return resp({ ret: 0, msgs: inbound.splice(0), get_updates_buf: 'BUF' + Date.now() })
  }
  throw new Error('unexpected fetch url: ' + u)
}

// ---------- 预置已连接状态 ----------
mkdirSync(stateDir, { recursive: true })
writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
  version: 2,
  connected: { botToken: 'TOKEN', baseUrl: 'https://fake.example', accountId: 'bot-1', userId: 'u1', connectedAt: new Date().toISOString() },
  cursor: '',
  peers: {
    // 门控用例：该对端映射的会话 session-t3 已归档
    'wx-peer-arch': { currentProject: process.cwd(), projectSessions: { [process.cwd()]: 'session-t3' } },
  },
}, null, 2))

// ---------- 假 ctx ----------
const listeners = {}
const disposers = []
const createdAgents = []
const liveAgents = new Map()
const attachCalls = []
const presetMounts = []
const resumeCalls = []
function fakeAgent(id) {
  return { id, session: { id }, followups: [], followup(m) { this.followups.push(m) } }
}
const sessionTitles = {
  'session-t1': { title: 't1 测试会话', updatedAt: Date.now() - 60000 },
  'session-t2': { title: 't2 训练实验', updatedAt: Date.now() - 120000 },
  'session-t3': { title: 't3 归档会话', updatedAt: Date.now() - 180000 },
}
const longText = (n) => 'x'.repeat(n)
const t1Exchanges = []
for (let i = 1; i <= 6; i++) {
  t1Exchanges.push({ type: 'user/message', data: { content: [{ type: 'text', text: '第' + i + '轮指令 ' + longText(260) }] } })
  // 第 6 轮回复超长（>1500 字符）：回放必须完整呈现（回归「/session 回放被截断」）
  const aText = i === 6 ? '第' + i + '轮回复 ' + longText(1500) + '\n回顾全文结尾' : '第' + i + '轮回复 ' + longText(260)
  t1Exchanges.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: aText }] } } })
}
const sessionEvents = {
  'session-t1': [
    { type: 'todo/write', data: { todos: [{ content: 'done-1', status: 'completed' }, { content: 'doing-2', status: 'in_progress' }, { content: 'todo-3', status: 'pending' }] } },
    { type: 'tool/call', data: { name: 'remlab_exec' } },
    ...t1Exchanges,
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ],
  'session-t2': [
    { type: 'turn/end', data: { reason: { kind: 'error', error: { message: '模型超时' } } } },
  ],
}
const fakeCtx = {
  get(svc) {
    if (svc === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }) }
    if (svc === 'commands') return { list: async () => [{ name: 'plan', description: '计划模式' }, { name: 'goal', description: '目标管理' }] }
    if (svc === 'skills') return { list: async () => [
      { name: 'archify', description: '架构图生成', invocation: { userInvocable: true } },
      { name: 'hidden-skill', description: '不应出现', invocation: { userInvocable: false } },
    ] }
    if (svc === 'sessionQuery') return {
      readTitle: async (id) => sessionTitles[id],
      readSession: async (id) => ({ events: sessionEvents[id] || [] }),
    }
    if (svc === 'agentPresets') return {
      resolve: async (id) => ({ id: id || 'default-preset' }),
      mount: async (agentCtx, rid) => { presetMounts.push({ ctx: agentCtx, rid }) },
    }
    if (svc === 'sessionPersistence') return {
      inspect: async () => ({ meta: { agentPreset: 'standard' } }),
    }
    return undefined
  },
  webServer: { register() { return () => {} } },
  agents: {
    async create(opts) {
      createdAgents.push(opts)
      const a = fakeAgent(opts.sessionId)
      liveAgents.set(opts.sessionId, a)
      return { agent: a, dispose: async () => liveAgents.delete(opts.sessionId) }
    },
    async resume(opts) {
      resumeCalls.push(opts)
      const a = fakeAgent(opts.resumeSessionId)
      liveAgents.set(opts.resumeSessionId, a)
      return { agent: a, dispose: async () => liveAgents.delete(opts.resumeSessionId) }
    },
    get(id) { return liveAgents.get(id) },
    currentInitiator() { return undefined },
  },
  workspaceRegistry: {
    archivedSessionIds: ['session-t3'], // 已归档会话：/sessions 必须过滤掉
    list() {
      return [{
        id: 'w1',
        path: process.cwd(),
        title: 'test-workspace',
        attachSession: (sid) => { attachCalls.push(sid); return Promise.resolve() },
        get sessionIds() { return ['session-t1', 'session-t2', 'session-t3', ...attachCalls.slice(-1)] },
      }]
    },
  },
  tools: { register() { return () => {} } },
  on(name, fn) { listeners[name] = fn; return () => { delete listeners[name] } },
  effect(fn) { disposers.push(fn); return () => {} },
}

const { apply } = await import('../lib/wechat-channel.js')
apply(fakeCtx)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, label, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fn()) return
    await sleep(25)
  }
  throw new Error('超时等待: ' + label)
}
const pushMsg = (text, ctx, peerId = 'wx-peer-1') => inbound.push({
  from_user_id: peerId,
  message_type: 1,
  message_state: 2,
  context_token: ctx,
  item_list: [{ type: 1, text_item: { text } }],
})

// 0. boot 恢复门控：已归档会话（session-t3）不被恢复（映射保留，等用户消息时告知）
await sleep(300)
if (resumeCalls.some((r) => r.resumeSessionId === 'session-t3')) throw new Error('boot 不应恢复已归档会话 session-t3')
if (liveAgents.has('session-t3')) throw new Error('归档会话不应进入 live')
console.log('ok boot 门控：归档会话跳过恢复（映射保留）')

// 0.5 门控（硬拒绝）：映射已归档 → 消息不执行 + 微信收到门控提示 + 映射清除
pushMsg('do archived work', 'CTXG', 'wx-peer-arch')
await waitFor(() => outbound.some((m) => m.to_user_id === 'wx-peer-arch' && (m.item_list || []).some((i) => i.text_item && String(i.text_item.text).includes('Web 端归档'))), '门控拒绝回复')
if (liveAgents.has('session-t3')) throw new Error('门控后归档会话不应被复活')
console.log('ok 门控：已归档会话消息被硬拒绝（不执行、不恢复）')

// 0.6 映射已清除 → 下一条消息自动新建可见会话
const beforeFresh = createdAgents.length
pushMsg('fresh work', 'CTXG2', 'wx-peer-arch')
await waitFor(() => createdAgents.length > beforeFresh, '门控后自动新建会话')
const freshAgent = createdAgents[createdAgents.length - 1]
if (freshAgent.sessionId === 'session-t3') throw new Error('新建会话不应复用归档 id')
await waitFor(() => liveAgents.get(freshAgent.sessionId) && liveAgents.get(freshAgent.sessionId).followups.length >= 1, '新会话 followup 送达')
console.log('ok 门控后新建可见会话并继续工作')

// 1. 入站普通消息 → 自动建会话（cwd=项目，含模型选择+setup）→ followup
const beforeHello = createdAgents.length
pushMsg('hello', 'CTX1')
await waitFor(() => createdAgents.length > beforeHello, '自动建会话')
const helloOpts = createdAgents[createdAgents.length - 1]
const a = liveAgents.get(helloOpts.sessionId)
await waitFor(() => a.followups.length >= 1, 'followup 送达')
if (a.followups[0].content[0].text !== 'hello') throw new Error('followup 内容错误')
if (helloOpts.meta.cwd !== process.cwd()) throw new Error('会话 cwd 未绑定项目: ' + JSON.stringify(helloOpts.meta))
if (typeof helloOpts.setup !== 'function') throw new Error('create 未装配 setup（模型选择注入缺失）')
if (!helloOpts.agentOptions || helloOpts.agentOptions.model !== 'deepseek-v4-pro') throw new Error('create 未携带 agentOptions: ' + JSON.stringify(helloOpts.agentOptions))
if (!String(helloOpts.sessionId).startsWith('session-')) throw new Error('sessionId 缺 session- 前缀: ' + helloOpts.sessionId)
if (helloOpts.meta.agentPreset !== 'default-preset') throw new Error('create meta 未记录默认预设 id: ' + JSON.stringify(helloOpts.meta))
await helloOpts.setup({ on: () => () => {} })
if (presetMounts.length < 1 || presetMounts[0].rid !== 'default-preset') throw new Error('create setup 未挂载预设: ' + JSON.stringify(presetMounts))
await waitFor(() => attachCalls.length >= 1, 'attachSession 调用')
if (attachCalls[0] !== createdAgents[0].sessionId) throw new Error('attachSession 参数不符: ' + JSON.stringify(attachCalls))
console.log('ok 入站消息 → 自动建会话(cwd=项目 + 模型选择/setup + 预设挂载 + 工作区挂接) → followup')

// 2. 同一对端复用会话
const afterHello = createdAgents.length
pushMsg('again', 'CTX2')
await waitFor(() => a.followups.length >= 2, '第二条 followup')
if (createdAgents.length !== afterHello) throw new Error('会话未复用，create 次数=' + createdAgents.length)
console.log('ok 同一对端复用会话（create 仅 1 次）')

// 3. /switch 命令（惰性：切换项目不创建会话，避免产生空对话）
{
  const beforeSwitch = createdAgents.length
  pushMsg('/switch 1', 'CTX3')
  await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('已切换到项目')), '/switch 回复')
  if (createdAgents.length !== beforeSwitch) throw new Error('/switch 不应创建会话: ' + beforeSwitch + ' → ' + createdAgents.length)
  console.log('ok /switch 命令 → 切换项目且不创建空会话')
}

// 4. /projects 命令
pushMsg('/projects', 'CTX4')
await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('test-workspace')), '/projects 回复')
console.log('ok /projects 命令 → 列表包含项目')

// 4b. /help 增强：插件命令 + 对话可用命令 + 可用技能
pushMsg('/help', 'CTX4b')
await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('可用技能')), '/help 回复')
const helpText = outbound[outbound.length - 1].item_list[0].text_item.text
if (!helpText.includes('【插件命令】') || !helpText.includes('/switch')) throw new Error('/help 缺插件命令段')
if (!helpText.includes('【对话可用命令】') || !helpText.includes('/plan') || !helpText.includes('/goal')) throw new Error('/help 缺对话命令段: ' + helpText.slice(0, 300))
if (!helpText.includes('【可用技能】') || !helpText.includes('archify')) throw new Error('/help 缺技能段')
if (helpText.includes('hidden-skill')) throw new Error('/help 不应包含 userInvocable=false 的技能')
if (!helpText.includes('/sessions') || !helpText.includes('/session')) throw new Error('/help 缺会话命令')
console.log('ok /help → 插件命令 + 对话命令(/plan /goal) + 技能(archify) + 会话命令')

// 4c. /sessions 会话列表
pushMsg('/sessions', 'CTX4c')
await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('t1 测试会话')), '/sessions 回复')
const sessionsText = outbound[outbound.length - 1].item_list[0].text_item.text
if (!sessionsText.includes('t2 训练实验')) throw new Error('/sessions 缺 t2')
if (sessionsText.includes('t3 归档会话') || sessionsText.includes('session-t3')) throw new Error('/sessions 不应包含归档会话: ' + sessionsText.slice(0, 400))
if (!sessionsText.includes('★当前')) throw new Error('/sessions 缺当前标记')
console.log('ok /sessions → 会话列表（标题 + 当前标记 + 归档过滤）')

// 4d. /session 2 切换 + 进度回放（error 回合）
pushMsg('/session 2', 'CTX4d')
await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('已切换到会话: t2 训练实验')), '/session 回复')
const sess2Text = outbound[outbound.length - 1].item_list[0].text_item.text
if (!sess2Text.includes('error: 模型超时')) throw new Error('/session 缺错误回合回放: ' + sess2Text.slice(0, 300))
console.log('ok /session 2 → 切换 + 回放（最近回合状态 error）')
// 首次 resume 的 setup 应按会话存储预设挂载 standard（真实运行时由 loop 调用 setup）
await resumeCalls[0].setup({ on: () => () => {} })
if (!presetMounts.some((m) => m.rid === 'standard')) throw new Error('resume setup 未挂载存储预设 standard: ' + JSON.stringify(presetMounts.map((m) => m.rid)))
console.log('ok resume setup → 挂载会话存储的预设 standard')

// 4e. 切换后普通消息进入指定会话
pushMsg('继续工作', 'CTX4e')
const t2Agent = liveAgents.get('session-t2')
await waitFor(() => t2Agent && t2Agent.followups.length >= 1, 't2 followup')
if (t2Agent.followups[0].content[0].text !== '继续工作') throw new Error('t2 followup 内容错误')
console.log('ok 切换后普通消息 → 进入 session-t2')

// 4f. /session t1（id 前缀）+ 完整进度回放（todo/工具/多轮对话/状态），长文本分条无截断
pushMsg('/session t1', 'CTX4f')
await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('已切换到会话: t1 测试会话')), '/session t1 回复')
// 等待本次回放的最后一个分条到达（锚定 t1 回复之后，避免匹配到历史 /session 2 的末条）
await waitFor(() => {
  const texts = outbound.map((m) => m.item_list[0].text_item.text)
  const idx = texts.findIndex((t) => t.includes('已切换到会话: t1 测试会话'))
  if (idx === -1) return false
  return texts.slice(idx).join('').includes('（之后的普通消息将在该会话继续）')
}, 't1 回放末条到达')
const sess1Joined = outbound.map((m) => m.item_list[0].text_item.text).join('\n')
for (const mark of ['任务列表（最新 todo）', '✅ done-1', '🔄 doing-2', '⬜ todo-3', '最近使用的工具: remlab_exec', '第2轮指令', '第6轮回复', '回顾全文结尾', '最近回合状态: completed']) {
  if (!sess1Joined.includes(mark)) throw new Error('/session t1 回放缺: ' + mark)
}
if (outbound.some((m) => m.item_list[0].text_item.text.includes('已截断'))) throw new Error('回放不应出现截断标记')
console.log('ok /session t1 → 完整进度回放（todo/工具/多轮对话/状态）+ 长文本分条无截断')

// 4g. 未知 /xxx 与消息中段的 /session → 一律发给 Agent（不再被解析执行）
{
  const t1Agent = liveAgents.get('session-t1')
  const before = t1Agent.followups.length
  pushMsg('/foobar 123', 'CTX4g')
  await waitFor(() => t1Agent.followups.length >= before + 1, '未知命令 followup')
  if (t1Agent.followups[before].content[0].text !== '/foobar 123') throw new Error('未知 /xxx 应原样发给 Agent')
  pushMsg('请继续 /session 2 然后总结', 'CTX4h')
  await waitFor(() => t1Agent.followups.length >= before + 2, '消息中段命令 followup')
  if (t1Agent.followups[before + 1].content[0].text !== '请继续 /session 2 然后总结') throw new Error('消息中段 /session 应原样发给 Agent')
  console.log('ok 未知 /xxx 与消息中段 /session → 均发给 Agent（仅消息开头命令被解析）')
}

// 5. 出站：turn 结束把最终 assistant 文本推回微信（当前映射会话 = session-t1）
const se = listeners['session/event']
if (typeof se !== 'function') throw new Error('缺少 session/event 监听')
se({ id: 'session-t1' }, { type: 'assistant/message', seq: 1, time: Date.now(), data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'agent answer' }] } } })
se({ id: 'session-t1' }, { type: 'turn/end', seq: 2, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('agent answer')), '出站推送')
console.log('ok turn 结束 → assistant 文本推回微信')

// 5b. 回合异常结束且无回复 → 推回错误摘要（避免静默失败）
se({ id: 'session-t1' }, { type: 'turn/end', seq: 99, time: Date.now(), data: { turn: 9, reason: { kind: 'error', error: { message: 'prompt variable "{{model}}" has no value', code: 'UNKNOWN' } } } })
await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('Agent 回合出错')), '错误摘要推送')
console.log('ok 回合异常 → 错误摘要推回微信')

// 5c. 长回复分条推送（无截断）
se({ id: 'session-t1' }, { type: 'assistant/message', seq: 100, time: Date.now(), data: { turn: 10, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '长回复开头\n' + longText(2400) + '\n长回复结尾' }] } } })
se({ id: 'session-t1' }, { type: 'turn/end', seq: 101, time: Date.now(), data: { turn: 10, reason: { kind: 'completed' } } })
await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('长回复结尾')), '长回复分条')
if (!outbound.some((m) => m.item_list[0].text_item.text.includes('（2/2）') && m.item_list[0].text_item.text.includes('长回复结尾'))) throw new Error('分条标记缺失')
console.log('ok 长回复 → 分条发送，完整无截断')

// 5d. /session new 主动新建会话
{
  const beforeNew = createdAgents.length
  pushMsg('/session new', 'CTX5d')
  await waitFor(() => createdAgents.length >= beforeNew + 1, '新会话创建')
  const newId = createdAgents[createdAgents.length - 1].sessionId
  await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('已创建新会话')), '/session new 回复')
  if (!String(newId).startsWith('session-')) throw new Error('新会话 id 缺前缀: ' + newId)
  console.log('ok /session new → 创建新会话 ' + newId.slice(0, 8))

  // 5e. 新消息进入新会话
  pushMsg('新会话第一条消息', 'CTX5e')
  const newAgent = liveAgents.get(newId)
  await waitFor(() => newAgent && newAgent.followups.length >= 1, '新会话 followup')
  if (newAgent.followups[0].content[0].text !== '新会话第一条消息') throw new Error('新会话 followup 内容错误')
  console.log('ok /session new 后普通消息 → 进入新会话')

  // 5f. 完成推送：先发可复制的跳转指令，再发归属头 + 输出
  se({ id: newId }, { type: 'assistant/message', seq: 200, time: Date.now(), data: { turn: 20, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'context answer' }] } } })
  se({ id: newId }, { type: 'turn/end', seq: 201, time: Date.now(), data: { turn: 20, reason: { kind: 'completed' } } })
  await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('context answer')), '带上下文完成推送')
  const texts = outbound.map((m) => m.item_list[0].text_item.text)
  const jumpIdx = texts.findIndex((t) => /^⚡ 回连本会话: \/go 1 \d+$/.test(t))
  const bodyIdx = texts.findIndex((t) => t.includes('context answer'))
  if (jumpIdx < 0) throw new Error('完成推送缺跳转指令行: ' + texts.slice(-4).join(' | '))
  if (bodyIdx < 0 || jumpIdx > bodyIdx) throw new Error('跳转指令应在输出之前')
  if (!/📌 项目「[^」]+」 · 会话「/.test(texts[bodyIdx])) throw new Error('完成推送缺项目+会话上下文: ' + texts[bodyIdx].slice(0, 200))
  console.log('ok 完成推送 → 先跳转指令(/go 1 n)后归属+输出')

  // 5g. /go <项目> <会话> 跨项目直达
  pushMsg('/go 1 2', 'CTX5g')
  await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('已直达') && m.item_list[0].text_item.text.includes('t2 训练实验')), '/go 1 2 回复')
  const t2AgentAfter = liveAgents.get('session-t2')
  pushMsg('直达后消息', 'CTX5g2')
  await waitFor(() => t2AgentAfter && t2AgentAfter.followups.length >= 2, '直达后 t2 followup')
  if (t2AgentAfter.followups[t2AgentAfter.followups.length - 1].content[0].text !== '直达后消息') throw new Error('直达后消息未进入 t2')
  console.log('ok /go 1 2 → 跨项目直达 t2（后续消息进入该会话）')
  // 恢复路径按会话存储预设挂载（sessionPersistence.inspect → 'standard'）
  if (!presetMounts.some((m) => m.rid === 'standard')) throw new Error('resume setup 未按存储预设挂载: ' + JSON.stringify(presetMounts.map((m) => m.rid)))
  console.log('ok resume 路径 → 挂载会话存储的预设 standard')

  // 5h. /go <会话> 单参数（当前项目内切会话）
  pushMsg('/go 1', 'CTX5h')
  await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('已直达') && m.item_list[0].text_item.text.includes('t1 测试会话')), '/go 1 回复')
  console.log('ok /go 1 → 单参数规则解析为当前项目会话 t1')
}

// 6. context_token 回显
const last = outbound[outbound.length - 1]
if (last.context_token !== 'CTX5h') throw new Error('context_token 未回显: ' + JSON.stringify(last.context_token))
console.log('ok context_token 回显（' + last.context_token + '）')

// 6b. /status 显示会话标题（当前映射 = session-t1，标题 t1 测试会话）
{
  pushMsg('/status', 'CTX6b')
  await waitFor(() => outbound.some((m) => m.item_list[0].text_item.text.includes('会话: t1 测试会话')), '/status 显示标题')
  const st = outbound.map((m) => m.item_list[0].text_item.text).join('\n')
  if (!st.includes('会话: t1 测试会话') || !st.includes('session-')) throw new Error('/status 应同时包含标题与会话 id 前缀')
  console.log('ok /status → 显示会话标题（t1 测试会话 + id 前缀）')
}

// 7. 卸载清理（触发内部 disposer 停监控）
for (const d of disposers) {
  try {
    const inner = d()
    if (typeof inner === 'function') inner()
  } catch (e) { console.log('disposer warn:', e && e.message) }
}
await sleep(200)
console.log('BRIDGE OK')
process.exit(0)
