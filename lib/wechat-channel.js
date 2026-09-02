/**
 * dsh-wechat-channel 宿主半：
 *  - 微信 ClawBot（腾讯 iLink 官方 Bot API）全局绑定整个 dsh web（非按项目/对话）。
 *  - 每个微信对端（私聊）↔ DSH 会话映射；会话按「对端 × 项目」隔离。
 *  - 基于对话的项目查询/切换：插件级 /status /projects /switch 命令 +
 *    Agent 级工具 dsh_wc_projects / dsh_wc_status / dsh_wc_switch_project。
 *  - 出站：监听 session/event，turn 结束时把最终 assistant 文本推回微信。
 *  - 全局状态存 ~/.dsh/wechat-channel/state.json；设置页经同源 API 路由读取。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  FIXED_BASE_URL, STALE_TOKEN_ERRCODE,
  fetchQrCode, pollQrStatus, getUpdates, sendText, notifyStart, notifyStop,
} from './ilink.js'

export const name = 'wechat-channel'
export const inject = ['webServer', 'agents', 'workspaceRegistry', 'tools']

const STATE_DIR = process.env.DSH_WECHAT_STATE_DIR || join(homedir(), '.dsh', 'wechat-channel')
const STATE_FILE = join(STATE_DIR, 'state.json')
const MAX_REPLY_CHARS = 4000
const LOGIN_TTL_MS = 5 * 60_000
const MAX_QR_REFRESH = 3

function log(...a) { console.log('[wechat-channel]', ...a) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const STATE_VERSION = 2
function loadState() {
  let s
  try {
    s = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    if (!s || typeof s !== 'object') throw new Error('bad state')
  } catch {
    s = {}
  }
  const merged = { version: STATE_VERSION, connected: null, cursor: '', peers: {}, ...s }
  if (!merged.version || merged.version < 2) {
    // v1 会话是在缺少模型选择注入时创建的（回合在预步装配阶段报错、无法修复），
    // 迁移：清空项目会话映射，下次消息用修复后的路径重新建会话。
    for (const peer of Object.values(merged.peers || {})) {
      if (peer && typeof peer === 'object') peer.projectSessions = {}
    }
    merged.version = STATE_VERSION
  }
  return merged
}
function saveState(s) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
  } catch (e) { log('saveState failed:', e && e.message) }
}

export function apply(ctx) {
  const state = loadState()
  const handles = new Map() // sessionId -> AgentHandle（插件卸载时统一 dispose）
  let monitorAbort = null
  let login = null // 登录状态机
  const pendingText = new Map() // sessionId -> turn 内累积的 assistant 文本

  // ---------- 项目列表 ----------
  function listProjects() {
    let ws = []
    try { ws = ctx.workspaceRegistry.list() || [] } catch { ws = [] }
    return ws
      .filter((w) => w && w.path && existsSync(w.path))
      .map((w) => ({ path: w.path, title: w.title || basename(w.path), remote: existsSync(join(w.path, '.dsh-remote.json')) }))
  }

  // ---------- 登录状态机 ----------
  function loginSummary() {
    if (!login) return null
    return { phase: login.phase, qrcodeUrl: login.qrcodeUrl, message: login.message }
  }
  async function startLogin() {
    if (state.connected) return { ok: false, error: '已连接微信，请先断开再重新连接' }
    if (login) return { ok: true, login: loginSummary() }
    try {
      const qr = await fetchQrCode()
      if (!qr || !qr.qrcode) return { ok: false, error: '获取二维码失败: ' + JSON.stringify(qr).slice(0, 200) }
      login = {
        qrcode: qr.qrcode,
        qrcodeUrl: qr.qrcode_img_content || '',
        base: FIXED_BASE_URL,
        phase: 'qr',
        pendingVerifyCode: '',
        refreshCount: 0,
        startedAt: Date.now(),
        message: '请用手机微信扫码，并在手机端确认启用微信 ClawBot 插件',
      }
      loginLoop().catch((e) => log('loginLoop crashed:', e && (e.stack || e.message)))
      return { ok: true, login: loginSummary() }
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) }
    }
  }
  async function refreshQr() {
    try {
      const qr = await fetchQrCode()
      if (qr && qr.qrcode) {
        login.qrcode = qr.qrcode
        login.qrcodeUrl = qr.qrcode_img_content || ''
        login.base = FIXED_BASE_URL
        login.phase = 'qr'
        login.pendingVerifyCode = ''
        login.startedAt = Date.now()
        login.message = '二维码已更新，请重新扫码'
        return true
      }
    } catch (e) { log('refreshQr failed:', e && e.message) }
    return false
  }
  async function loginLoop() {
    const deadline = login.startedAt + LOGIN_TTL_MS
    while (login && Date.now() < deadline) {
      try {
        const resp = await pollQrStatus(login.base, login.qrcode, login.pendingVerifyCode || undefined)
        const st = resp && resp.status
        switch (st) {
          case 'scaned':
            login.phase = 'scanned'
            login.message = '已扫码，正在手机上确认…'
            if (login.pendingVerifyCode) login.pendingVerifyCode = '' // 验证码已被接受
            break
          case 'need_verifycode':
            login.phase = 'verify'
            login.message = '请输入手机微信上显示的数字'
            break
          case 'expired':
          case 'verify_code_blocked':
            login.refreshCount += 1
            login.pendingVerifyCode = ''
            if (login.refreshCount > MAX_QR_REFRESH) {
              login.phase = 'error'
              login.message = '二维码多次失效，请重新发起连接'
              return
            }
            if (!(await refreshQr())) {
              login.phase = 'error'
              login.message = '二维码刷新失败，请重新发起连接'
              return
            }
            break
          case 'binded_redirect':
            login.phase = 'error'
            login.message = '该微信已连接过其他端点（ClawBot 一次只能连接一个）。请先在微信 ClawBot 插件中解除原连接后重试。'
            return
          case 'scaned_but_redirect':
            if (resp.redirect_host) {
              login.base = 'https://' + String(resp.redirect_host)
              login.message = '正在切换接入点…'
            }
            break
          case 'confirmed': {
            if (!resp.ilink_bot_id) {
              login.phase = 'error'
              login.message = '登录失败：服务器未返回 bot id，请重试'
              return
            }
            // 防御性归一化：官方插件直接以 baseurl 为根拼接 ilink/bot/*，
            // 说明 baseurl 是主机根；万一带 /ilink/bot 后缀则去掉，避免路径双写。
            const baseUrl = String(resp.baseurl || FIXED_BASE_URL).replace(/\/+$/, '').replace(/\/ilink\/bot$/, '')
            state.connected = {
              botToken: resp.bot_token,
              baseUrl,
              accountId: String(resp.ilink_bot_id),
              userId: resp.ilink_user_id || '',
              connectedAt: new Date().toISOString(),
            }
            saveState(state)
            login = null
            notifyStart(state.connected.baseUrl, state.connected.botToken).catch(() => {})
            startMonitor()
            log('wechat connected:', state.connected.accountId)
            return
          }
          default:
            break // wait 或未知状态 → 继续轮询
        }
      } catch (e) {
        log('poll status error:', e && e.message)
      }
      await sleep(1000)
    }
    if (login) {
      login.phase = 'error'
      login.message = '登录超时，请重新发起'
    }
  }

  // ---------- 长轮询监控 ----------
  function startMonitor() {
    if (!state.connected) return
    if (monitorAbort) { try { monitorAbort.abort() } catch {} }
    monitorAbort = new AbortController()
    const signal = monitorAbort.signal
    monitorLoop(signal).catch((e) => {
      if (!signal.aborted) log('monitor loop crashed:', e && (e.stack || e.message))
    })
  }
  async function monitorLoop(signal) {
    let failures = 0
    while (!signal.aborted && state.connected) {
      try {
        const resp = await getUpdates(state.connected.baseUrl, state.connected.botToken, state.cursor, { signal })
        if (signal.aborted) return
        const errcode = resp && resp.errcode !== undefined && resp.errcode !== 0 ? resp.errcode : null
        const ret = resp && resp.ret !== undefined && resp.ret !== 0 ? resp.ret : null
        if (errcode !== null || ret !== null) {
          if (errcode === STALE_TOKEN_ERRCODE) {
            log('token stale (-14)：需要重新扫码连接')
            state.connected = null
            saveState(state)
            return
          }
          failures += 1
          log('getupdates api error:', JSON.stringify(resp).slice(0, 200))
          await sleep(failures >= 3 ? 30000 : 2000)
          continue
        }
        failures = 0
        if (resp && resp.get_updates_buf) {
          state.cursor = String(resp.get_updates_buf)
          saveState(state)
        }
        for (const msg of (resp && resp.msgs) || []) {
          try { await handleInbound(msg) } catch (e) { log('handleInbound error:', e && (e.stack || e.message)) }
        }
      } catch (e) {
        if (signal.aborted) return
        failures += 1
        log('getupdates error:', e && e.message)
        await sleep(failures >= 3 ? 30000 : 2000)
      }
    }
  }

  // ---------- 对端 ↔ 会话 ----------
  function ensurePeer(peerId) {
    if (!state.peers[peerId]) {
      const first = listProjects()[0]
      state.peers[peerId] = {
        currentProject: first ? first.path : '',
        projectSessions: {},
        lastContextToken: '',
        lastInboundAt: 0,
        lastOutboundAt: 0,
      }
      saveState(state)
    }
    return state.peers[peerId]
  }
  // ---------- 模型选择注入（等价 @deepseek-ai/dsh-agent 的 installModelSelection） ----------
  // 会话必须装配 agentDefaultModel 的当前选择：persona 等提示段依赖 {{model}}/{{provider}} 变量，
  // 缺失时回合在预步装配阶段直接报错（症状：微信无回复、对话无消息）。
  function currentModelSelection() {
    const adm = ctx.get('agentDefaultModel')
    if (!adm || typeof adm.currentSelection !== 'function') return undefined
    try { return adm.currentSelection() || undefined } catch { return undefined }
  }
  // ---------- 预设挂载（等价 Web 应用 composeAgent 的 setup 路径） ----------
  // 核心工具（fs/pwsh/todo/web 等）在预设组合里按 agent 作用域注册；
  // Web 路径在 setup 中 presets.mount(agentCtx, id) 安装它们。此前本插件
  // 只注入模型选择、从不挂载预设——凡被微信 resume/create 接管重建作用域的
  // 会话（含分叉会话），核心工具即丢失。这里补齐同等挂载。
  async function resolvePresetFor(sessionId) {
    const presets = ctx.get('agentPresets')
    if (!presets || typeof presets.mount !== 'function') return { id: undefined, mount: async () => {} }
    try {
      let storedId
      if (sessionId) {
        const sp = ctx.get('sessionPersistence')
        if (sp && typeof sp.inspect === 'function') {
          const insp = await sp.inspect(sessionId)
          const meta = insp && (insp.meta || insp.header)
          storedId = meta && meta.agentPreset
        }
      }
      const resolved = await presets.resolve(storedId) // 缺省→默认预设
      const rid = resolved && resolved.id
      return {
        id: rid,
        mount: (agentCtx) => (rid === undefined ? Promise.resolve() : presets.mount(agentCtx, rid)),
      }
    } catch (e) {
      log('preset resolve failed:', e && e.message)
      return { id: undefined, mount: async () => {} }
    }
  }
  function makeAgentSetup(selection, presetMount) {
    const selRef = { current: selection, assembled: undefined }
    return async (agentCtx) => {
      if (selection) {
        agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
          const sel = selRef.current
          const assembled = await next()
          selRef.assembled = sel
          if (sel === undefined) return assembled
          return {
            ...assembled,
            variables: { ...(assembled.variables || {}), provider: sel.provider, model: sel.model },
          }
        })
        agentCtx.on('agent/request', async (_payload, next) => {
          const resolved = await next()
          const sel = selRef.assembled
          if (sel === undefined) return resolved
          const { reasoningEffort: _inheritedEffort, ...rest } = resolved
          return {
            ...rest,
            provider: sel.provider,
            model: sel.model,
            ...(sel.reasoningEffort === undefined ? {} : { reasoningEffort: sel.reasoningEffort }),
          }
        })
      }
      if (presetMount) await presetMount(agentCtx)
    }
  }
  // ---------- 会话挂接到工作区 ----------
  // 直接 agents.create/resume 的会话不会进入 workspaceRegistry 的工作区记录，
  // Web 端侧边栏/对话列表因此不显示。attachSession 校验 cwd 并写入记录。
  function workspaceEntityFor(project) {
    let ws = []
    try { ws = ctx.workspaceRegistry.list() || [] } catch { ws = [] }
    const norm = (p) => resolve(p).replace(/[\\/]+$/, '')
    const projNorm = norm(project)
    const isWin = process.platform === 'win32'
    const eq = (a, b) => (isWin ? a.toLowerCase() === b.toLowerCase() : a === b)
    return ws.find((w) => w && w.path && eq(norm(w.path), projNorm) && typeof w.attachSession === 'function')
  }
  function attachToWorkspace(sessionId, project) {
    const entity = workspaceEntityFor(project)
    if (!entity) return Promise.resolve(false)
    return entity.attachSession(sessionId)
      .then(() => true)
      .catch((e) => {
        log('attachSession failed:', sessionId, e && e.message)
        return false
      })
  }
  // 主动创建全新会话（/session new）：不沿用现有映射，直接走 create 路径
  async function createSessionFor(peerId, project) {
    const peer = ensurePeer(peerId)
    if (!project || !existsSync(project)) return null
    const selection = currentModelSelection()
    const preset = await resolvePresetFor(undefined)
    const setup = makeAgentSetup(selection, preset.mount)
    const id = 'session-' + randomUUID() // 与 DSH 会话 id 惯例一致（session- 前缀）
    try {
      const handle = await ctx.agents.create({
        sessionId: id,
        meta: { cwd: project, ...(preset.id === undefined ? {} : { agentPreset: preset.id }) },
        ...(selection ? { agentOptions: { provider: selection.provider, model: selection.model } } : {}),
        setup,
      })
      handles.set(id, handle)
      peer.projectSessions[project] = id
      saveState(state)
      attachToWorkspace(id, project)
      return id
    } catch (e) {
      log('create agent failed:', e && e.message)
      return null
    }
  }
  async function ensureSession(peerId, project) {
    const peer = ensurePeer(peerId)
    if (!project || !existsSync(project)) return null
    let id = peer.projectSessions[project]
    if (id && isArchivedSession(id)) return null // 门控：已归档会话不恢复、不执行（映射由调用方在告知用户后清除）
    if (id && ctx.agents.get(id)) {
      attachToWorkspace(id, project) // 幂等：已挂接时直接跳过（防旧版本会话漏挂）
      return id
    }
    const selection = currentModelSelection()
    if (id) {
      const attemptResume = async () => {
        const preset = await resolvePresetFor(id) // 按会话存储的 agentPreset 挂载（与 Web 路径一致）
        const setup = makeAgentSetup(selection, preset.mount)
        const handle = await ctx.agents.resume({ resumeSessionId: id, setup })
        handles.set(id, handle)
        attachToWorkspace(id, project)
        return id
      }
      try {
        return await attemptResume()
      } catch (e) {
        const msg = e && e.message ? String(e.message) : String(e)
        if (msg.includes('while it is live') || msg.includes('cannot prepare')) {
          // HMR/竞态：旧实例 dispose 尚未完成 → 等待后重试一次，避免误建重复会话
          await sleep(500)
          try { return await attemptResume() } catch (e2) { log('resume retry failed:', id, e2 && e2.message) }
          if (ctx.agents.get(id)) { attachToWorkspace(id, project); return id }
        } else {
          log('resume failed:', id, e && e.message)
        }
        id = undefined
        delete peer.projectSessions[project]
        saveState(state)
      }
    }
    return createSessionFor(peerId, project)
  }
  function findPeerBySession(sessionId) {
    for (const [peerId, peer] of Object.entries(state.peers)) {
      for (const [, sid] of Object.entries(peer.projectSessions || {})) {
        if (sid === sessionId) return { peerId, peer }
      }
    }
    return null
  }
  function outText(peerId, peer, text) {
    if (!state.connected) return Promise.resolve()
    peer.lastOutboundAt = Date.now()
    saveState(state)
    return sendText(state.connected.baseUrl, state.connected.botToken, peerId, text, peer.lastContextToken)
      .catch((e) => log('sendText failed:', e && e.message))
  }
  // 长文本分条发送：在换行处切块（默认 1700 字符/条），前缀（i/n），逐条顺序发送
  async function sendChunked(peerId, peer, text, chunkSize = 1700) {
    const t = String(text)
    if (t.length <= chunkSize) return outText(peerId, peer, t)
    const chunks = []
    let rest = t
    while (rest.length > chunkSize) {
      let cut = rest.lastIndexOf('\n', chunkSize)
      if (cut <= chunkSize * 0.5) cut = chunkSize
      chunks.push(rest.slice(0, cut))
      rest = rest.slice(cut).replace(/^\n+/, '')
    }
    if (rest) chunks.push(rest)
    for (let i = 0; i < chunks.length; i++) {
      await outText(peerId, peer, (chunks.length > 1 ? '（' + (i + 1) + '/' + chunks.length + '）' : '') + chunks[i])
      if (i < chunks.length - 1) await sleep(250)
    }
  }

  // ---------- 会话选择与进度回放 ----------
  const clip = (s, n) => {
    const t = String(s).replace(/\s+/g, ' ').trim()
    return t.length > n ? t.slice(0, n) + '…' : t
  }
  // 门控：会话是否已在 Web 端归档（归档会话不可见，禁止在其中执行任何工作）
  function isArchivedSession(sessionId) {
    try {
      const al = ctx.workspaceRegistry.archivedSessionIds
      if (Array.isArray(al)) return al.map(String).includes(String(sessionId))
    } catch (e) { log('archivedSessionIds read failed:', e && e.message) }
    return false
  }
  async function listProjectSessions(project) {
    const entity = workspaceEntityFor(project)
    // 排除已归档会话：归档后 id 仍保留在记录中（为可恢复），Web 端靠 archivedSessionIds 过滤
    let archived = new Set()
    try {
      const al = ctx.workspaceRegistry.archivedSessionIds
      if (Array.isArray(al)) archived = new Set(al.map(String))
    } catch {}
    const ids = entity ? (entity.sessionIds || []).map(String).filter((id) => !archived.has(id)) : []
    if (!ids.length) return []
    const sq = ctx.get('sessionQuery')
    const out = []
    for (const id of ids) {
      let title = ''
      let updatedAt = 0
      try {
        if (sq && typeof sq.readTitle === 'function') {
          const t = await sq.readTitle(id)
          if (t && typeof t.title === 'string') { title = t.title; updatedAt = t.updatedAt || 0 }
        }
      } catch {}
      out.push({ id, title: title || '（未命名会话）', updatedAt })
    }
    return out
  }
  // 让指定会话处于 live 状态（已 live 直接用；否则 resume；会话不存在返回 null）
  async function ensureSessionLive(sessionId, project) {
    if (isArchivedSession(sessionId)) return null // 门控：已归档会话不恢复
    if (ctx.agents.get(sessionId)) return sessionId
    const selection = currentModelSelection()
    const preset = await resolvePresetFor(sessionId)
    const setup = makeAgentSetup(selection, preset.mount)
    try {
      const handle = await ctx.agents.resume({ resumeSessionId: sessionId, setup })
      handles.set(sessionId, handle)
      attachToWorkspace(sessionId, project)
      return sessionId
    } catch (e) {
      log('session switch resume failed:', sessionId, e && e.message)
      return null
    }
  }
  // 该会话最新任务推进回放：todo 快照 + 近期对话往来 + 最近工具调用 + 回合状态
  async function sessionTitleOf(sessionId) {
    const sq = ctx.get('sessionQuery')
    try {
      if (sq && typeof sq.readTitle === 'function') {
        const t = await sq.readTitle(sessionId)
        if (t && typeof t.title === 'string' && t.title.trim()) return t.title.trim()
      }
    } catch (e) { log('readTitle failed:', sessionId, e && e.message) }
    return ''
  }
  async function sessionRecap(sessionId) {
    const lines = []
    const sq = ctx.get('sessionQuery')
    let lastTodo = null
    const exchanges = [] // [{user, assistant}]
    const toolNames = []
    const turnKinds = []
    let lastEventTime = 0
    if (sq && typeof sq.readSession === 'function') {
      try {
        const snap = await sq.readSession(sessionId)
        const events = (snap && snap.events) || []
        if (events.length) lastEventTime = events[events.length - 1].time || 0
        let curUser = ''
        let curAssistant = ''
        for (const ev of events.slice(-150)) {
          if (ev.type === 'todo/write') lastTodo = ev.data && ev.data.todos
          else if (ev.type === 'user/message') {
            const t = extractText(ev.data && ev.data.content)
            if (t) { if (curUser || curAssistant) { exchanges.push({ user: curUser, assistant: curAssistant }); curUser = ''; curAssistant = '' }; curUser = t }
          } else if (ev.type === 'assistant/message') {
            const t = extractText(ev.data && ev.data.message && ev.data.message.content)
            if (t) curAssistant = (curAssistant ? curAssistant + '\n' : '') + t
          } else if (ev.type === 'tool/call' && ev.data && ev.data.name) {
            if (!toolNames.includes(ev.data.name)) toolNames.push(ev.data.name)
          } else if (ev.type === 'turn/end') {
            const r = ev.data && ev.data.reason
            if (r) turnKinds.push(r.kind === 'error' ? 'error: ' + clip((r.error && (r.error.message || r.error.code)) || '', 200) : r.kind)
          }
        }
        if (curUser || curAssistant) exchanges.push({ user: curUser, assistant: curAssistant })
      } catch (e) { log('sessionRecap readSession failed:', sessionId, e && e.message) }
    }
    lines.push('会话: ' + String(sessionId).slice(0, 8) + '…' + (lastEventTime ? '（最近活动 ' + new Date(lastEventTime).toLocaleString('zh-CN', { hour12: false }) + '）' : '（无活动记录）'))
    if (Array.isArray(lastTodo) && lastTodo.length) {
      lines.push('任务列表（最新 todo）:')
      for (const t of lastTodo.slice(0, 20)) {
        const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬜'
        lines.push('  ' + icon + ' ' + clip(t.content, 80))
      }
    } else {
      lines.push('任务列表: 无')
    }
    if (toolNames.length) lines.push('最近使用的工具: ' + toolNames.slice(0, 10).join('、'))
    const recent = exchanges.slice(-5)
    if (recent.length) {
      lines.push('近期对话:')
      for (const x of recent) {
        // 完整内容（不截断）：sendChunked 会在换行处分条发送，无需逐条裁剪
        if (x.user) lines.push('  你: ' + x.user)
        if (x.assistant) lines.push('  Agent: ' + x.assistant)
      }
    }
    if (turnKinds.length) lines.push('最近回合状态: ' + turnKinds.slice(-4).reverse().join(' → '))
    return lines.join('\n')
  }

  // ---------- 入站 ----------
  // 只有消息首词是已知插件命令时才按命令处理；其余（含其他 /xxx 开头）一律发给 Agent
  const COMMAND_ALIASES = {
    status: 'status', 状态: 'status',
    projects: 'projects', 项目: 'projects',
    switch: 'switch', 切换: 'switch',
    sessions: 'sessions', 会话: 'sessions',
    session: 'session',
    go: 'go', 跳转: 'go', goto: 'go',
    help: 'help', 帮助: 'help',
  }
  function parseCommand(text) {
    const m = /^\/\s*([A-Za-z\u4e00-\u9fa5]+)/.exec(text)
    if (!m) return null
    const key = String(m[1]).toLowerCase()
    return COMMAND_ALIASES[key] || null
  }
  async function handleInbound(msg) {
    if (msg.message_type !== 1) return // 只处理用户消息
    if (msg.message_state !== 2) return // 只处理完整消息
    const peerId = msg.from_user_id
    if (!peerId) return
    const peer = ensurePeer(peerId)
    if (msg.context_token) peer.lastContextToken = String(msg.context_token)
    peer.lastInboundAt = Date.now()
    saveState(state)
    const item = (msg.item_list || []).find((i) => i && i.type === 1)
    const text = item && item.text_item ? String(item.text_item.text).trim() : ''
    if (!text) {
      await outText(peerId, peer, '（当前版本仅支持文字消息；图片/语音/文件请用文字描述）')
      return
    }
    const cmd = parseCommand(text)
    if (cmd) return handleCommand(peerId, cmd, text)
    return routeToAgent(peerId, peer, text)
  }
  async function routeToAgent(peerId, peer, text) {
    const project = peer.currentProject || (listProjects()[0] || {}).path || ''
    if (!project) {
      await outText(peerId, peer, '⚠ 没有可用项目：请先在 DSH Web 中创建工作区，然后用 /projects 查看。')
      return
    }
    // 门控（硬拒绝）：映射会话已在 Web 端归档 → 不执行、不恢复、不自动新建
    const mapped = peer.projectSessions[project]
    if (mapped && isArchivedSession(mapped)) {
      delete peer.projectSessions[project]
      saveState(state)
      await outText(peerId, peer, '⚠ 门控：当前会话 ' + mapped.slice(0, 8) + '… 已在 Web 端归档，本次消息未执行（避免在不可见会话中工作）。\n请发 /session new 新建会话继续，或 /sessions 查看当前项目会话。')
      return
    }
    const sessionId = await ensureSession(peerId, project)
    if (!sessionId) {
      await outText(peerId, peer, '⚠ 无法创建/恢复会话（项目目录不存在？）')
      return
    }
    const agent = ctx.agents.get(sessionId)
    if (!agent) {
      await outText(peerId, peer, '⚠ 会话未就绪，请稍后重试')
      return
    }
    agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
  }
  async function handleCommand(peerId, cmd, raw) {
    const parts = raw.slice(1).trim().split(/\s+/)
    const arg = parts.slice(1).join(' ')
    const peer = ensurePeer(peerId)
    const reply = (t) => sendChunked(peerId, peer, t)
    if (cmd === 'help') {
      const lines = [
        '【插件命令】',
        '/status 当前项目与会话',
        '/projects 项目列表',
        '/switch <编号|名称> 切换项目',
        '/sessions 当前项目的会话列表',
        '/session <编号|名称|id前缀> 切换到指定会话（附最近进度回放）；/session new 新建会话',
        '/go <项目> <会话> 跨项目直达目标会话（规则解析；单参数=当前项目内会话/项目）',
        '/help 帮助（含对话命令与技能）',
        '已归档会话将被门控拦截（不执行），请 /session new 新建后继续',
        '其他消息直接发给 Agent 处理（自然语言可用 dsh_wc_projects/dsh_wc_switch_project 等工具）',
      ]
      // 对话可用命令：取当前项目会话的 live agent 的命令视图
      const cur = peer.currentProject || ''
      const sid = cur ? peer.projectSessions[cur] : ''
      const agent = sid ? ctx.agents.get(sid) : undefined
      const cmds = ctx.get('commands')
      if (agent && cmds && typeof cmds.list === 'function') {
        try {
          const list = await cmds.list(agent)
          if (Array.isArray(list) && list.length) {
            lines.push('')
            lines.push('【对话可用命令】')
            for (const c of list) {
              if (!c || !c.name) continue
              lines.push('/' + String(c.name) + (c.description ? ' — ' + String(c.description) : ''))
            }
          }
        } catch (e) { log('commands.list failed:', e && e.message) }
      } else if (!sid) {
        lines.push('')
        lines.push('【对话可用命令】会话尚未建立——先发一条普通消息，或 /switch 后再查看')
      }
      // 可用技能：DSH 技能目录
      const skills = ctx.get('skills')
      if (skills && typeof skills.list === 'function') {
        try {
          const list = await skills.list()
          if (Array.isArray(list) && list.length) {
            lines.push('')
            lines.push('【可用技能】')
            const shown = list.filter((s) => s && s.name && s.invocation && s.invocation.userInvocable !== false).slice(0, 60)
            for (const s of shown) {
              lines.push('· ' + s.name + (s.description ? ' — ' + String(s.description).slice(0, 64) : ''))
            }
            if (shown.length < list.length) lines.push('…（仅列出前 ' + shown.length + ' 项）')
          }
        } catch (e) { log('skills.list failed:', e && e.message) }
      }
      return reply(lines.join('\n'))
    }
    if (cmd === 'status') {
      const cur = peer.currentProject || ''
      const remote = cur && existsSync(join(cur, '.dsh-remote.json')) ? '（已绑定远程）' : '（未绑定远程）'
      const mapped = peer.projectSessions[cur] || ''
      let sess = '（尚未建立，发消息自动创建）'
      if (mapped) {
        const title = await sessionTitleOf(mapped)
        sess = (title ? title + '（' + mapped.slice(0, 8) + '…）' : mapped) +
          (isArchivedSession(mapped) ? ' ⚠ 已归档（消息将被门控拦截，请 /session new）' : '')
      }
      return reply('当前项目: ' + (cur ? basename(cur) + ' ' + cur + ' ' + remote : '（无，发消息时自动选第一个项目）') +
        '\n会话: ' + sess +
        '\n连接时间: ' + (state.connected ? state.connected.connectedAt : '-'))
    }
    if (cmd === 'sessions') {
      const project = peer.currentProject || ''
      if (!project) return reply('还没有当前项目：先 /projects 查看、/switch <编号|名称> 切换')
      const list = await listProjectSessions(project)
      if (!list.length) return reply('项目 ' + basename(project) + ' 还没有会话（发一条普通消息即自动创建）')
      const cur = peer.projectSessions[project] || ''
      return reply('项目 ' + basename(project) + ' 的会话：\n' +
        list.map((s, i) => (i + 1) + '. ' + clip(s.title, 40) + '（' + String(s.id).slice(0, 8) + '…' + (s.updatedAt ? '，' + new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '') + '）' + (s.id === cur ? ' ★当前' : '')).join('\n') +
        '\n用 /session <编号|名称|id前缀> 切换')
    }
    if (cmd === 'session') {
      const project = peer.currentProject || ''
      if (!project) return reply('还没有当前项目：先 /projects、/switch 切换')
      if (arg === 'new' || arg === '新建') {
        const id = await createSessionFor(peerId, project)
        if (!id) return reply('⚠ 新会话创建失败（项目目录不存在？）')
        return reply('✅ 已创建新会话: ' + id + '\n（项目 ' + basename(project) + '；之后的普通消息将在该会话继续，/sessions 查看列表）')
      }
      if (!arg) return reply('用法: /session <编号|名称|id前缀> 切换；/session new 新建会话')
      const list = await listProjectSessions(project)
      if (!list.length) return reply('项目 ' + basename(project) + ' 还没有会话')
      const n = parseInt(arg, 10)
      let target = null
      if (!Number.isNaN(n) && n >= 1 && n <= list.length) target = list[n - 1]
      else target = list.find((s) => String(s.id).startsWith(arg) || (s.title || '').includes(arg) || String(s.id) === arg)
      if (!target) return reply('未找到会话: ' + arg + '（用 /sessions 查看列表）')
      const liveId = await ensureSessionLive(target.id, project)
      if (!liveId) return reply('⚠ 会话 ' + String(target.id).slice(0, 8) + '… 无法恢复（可能已不存在），请用 /sessions 重新查看')
      peer.projectSessions[project] = liveId
      saveState(state)
      const recap = await sessionRecap(liveId)
      return reply('✅ 已切换到会话: ' + clip(target.title, 40) + '\n' + recap + '\n（之后的普通消息将在该会话继续）')
    }
    if (cmd === 'projects' || cmd === '项目') {
      const ps = listProjects()
      if (!ps.length) return reply('暂无项目（DSH 工作区为空）')
      return reply(ps.map((p, i) => (i + 1) + '. ' + p.title + ' ' + p.path + (p.remote ? ' [已绑定远程]' : '')).join('\n') + '\n用 /switch <编号|名称> 切换')
    }
    if (cmd === 'switch' || cmd === '切换') {
      if (!arg) return reply('用法: /switch <编号|名称>')
      const ps = listProjects()
      const n = parseInt(arg, 10)
      let target = null
      if (!Number.isNaN(n) && n >= 1 && n <= ps.length) target = ps[n - 1]
      else target = ps.find((p) => p.title === arg || p.path === arg || basename(p.path) === arg || (p.title || '').includes(arg) || p.path.includes(arg))
      if (!target) return reply('未找到项目: ' + arg + '（用 /projects 查看列表）')
      peer.currentProject = target.path
      saveState(state)
      // 惰性建会话：切换项目只改绑定，不产生空对话；会话在第一条普通消息时创建/复用
      return reply('✅ 已切换到项目: ' + target.title + '\n' + target.path + (target.remote ? '（已绑定远程）' : '') + '\n（会话将在你发送第一条普通消息时自动创建或复用）')
    }
    if (cmd === 'go') {
      // 规则解析：/go <项目> <会话> 跨项目直达；/go <会话> 当前项目内切会话；/go <项目> 只切项目
      const tokens = arg.split(/\s+/).filter(Boolean)
      const ps = listProjects()
      const resolveProject = (t) => {
        const n = parseInt(t, 10)
        if (!Number.isNaN(n) && n >= 1 && n <= ps.length) return ps[n - 1]
        return ps.find((p) => p.title === t || p.path === t || basename(p.path) === t || (p.title || '').includes(t) || p.path.includes(t))
      }
      const resolveSessionIn = async (projectPath, t) => {
        const list = await listProjectSessions(projectPath)
        const n = parseInt(t, 10)
        if (!Number.isNaN(n) && n >= 1 && n <= list.length) return list[n - 1]
        return list.find((s) => String(s.id) === t || String(s.id).startsWith(t) || (s.title || '').includes(t))
      }
      const switchToSession = async (projectPath, target) => {
        peer.currentProject = projectPath
        saveState(state)
        const liveId = await ensureSessionLive(target.id, projectPath)
        if (!liveId) return reply('⚠ 会话 ' + String(target.id).slice(0, 8) + '… 无法恢复（可能已不存在）')
        peer.projectSessions[projectPath] = liveId
        saveState(state)
        const recap = await sessionRecap(liveId)
        return reply('✅ 已直达: 项目「' + basename(projectPath) + '」· 会话「' + clip(target.title, 40) + '」\n' + recap + '\n（之后的普通消息将在该会话继续）')
      }
      if (!tokens.length) {
        const cur = peer.currentProject || ''
        return reply('用法（规则解析）:\n/go <项目> <会话> 跨项目直达目标会话\n/go <会话> 当前项目内切会话\n/go <项目> 只切项目\n当前: 项目 ' + (cur ? basename(cur) : '（无）') + ' / 会话 ' + (peer.projectSessions[cur] || '（无）'))
      }
      if (tokens.length >= 2) {
        const proj = resolveProject(tokens[0])
        if (!proj) return reply('未匹配到项目: ' + tokens[0] + '（/projects 查看列表）')
        const t2 = tokens.slice(1).join(' ')
        const target = await resolveSessionIn(proj.path, t2)
        if (!target) {
          const list = await listProjectSessions(proj.path)
          if (!list.length) return reply('项目「' + proj.title + '」还没有会话')
          return reply('项目「' + proj.title + '」中未找到会话: ' + t2 + '\n' + list.map((s, i) => (i + 1) + '. ' + clip(s.title, 32)).join('\n'))
        }
        return switchToSession(proj.path, target)
      }
      // 单 token：优先当前项目内会话，其次项目
      const cur = peer.currentProject || ''
      if (cur) {
        const target = await resolveSessionIn(cur, tokens[0])
        if (target) return switchToSession(cur, target)
      }
      const proj = resolveProject(tokens[0])
      if (proj) {
        peer.currentProject = proj.path
        saveState(state)
        return reply('✅ 已切换到项目: ' + proj.title + '\n（会话将在第一条普通消息时自动创建或复用；可继续 /go <会话>）')
      }
      return reply('未匹配到项目或会话: ' + tokens[0] + '（/projects、/sessions 查看列表）')
    }
    return reply('未知命令: /' + cmd + '（用 /help 查看可用命令）')
  }

  // ---------- 出站：turn 结束推送最终 assistant 文本 ----------
  function extractText(content) {
    if (!Array.isArray(content)) return ''
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim()
  }
  // 完成通知的归属行：项目 + 会话（标题优先，回退 id 前缀），异步任务结束后带上下文回推
  async function sessionContextLine(sessionId, projectPath) {
    let title = ''
    const sq = ctx.get('sessionQuery')
    try {
      if (sq && typeof sq.readTitle === 'function') {
        const t = await sq.readTitle(sessionId)
        if (t && typeof t.title === 'string') title = t.title
      }
    } catch {}
    const proj = projectPath ? basename(projectPath) : ''
    return '📌 ' + (proj ? '项目「' + proj + '」 · ' : '') + '会话「' + (title || String(sessionId).slice(0, 8) + '…') + '」'
  }
  // 生成可直接复制的回连跳转指令：/go <项目编号> <会话编号>（与 /projects、/sessions 编号一致）
  async function jumpCommandLine(projectPath, sessionId) {
    const ps = listProjects()
    const pi = ps.findIndex((p) => {
      const a = resolve(p.path).replace(/[\\/]+$/, '').toLowerCase()
      const b = resolve(projectPath).replace(/[\\/]+$/, '').toLowerCase()
      return a === b
    })
    const pn = pi >= 0 ? pi + 1 : null
    const list = projectPath ? await listProjectSessions(projectPath) : []
    const si = list.findIndex((s) => s.id === sessionId)
    const sn = si >= 0 ? si + 1 : null
    if (pn !== null && sn !== null) return '/go ' + pn + ' ' + sn
    if (pn !== null) return '/go ' + pn + ' ' + String(sessionId).slice(0, 8)
    if (projectPath) return '/go ' + basename(projectPath) + ' ' + String(sessionId).slice(0, 8)
    return '/go ' + String(sessionId).slice(0, 8)
  }
  async function pushTurnResult(peerId, peer, sessionId, body) {
    let projectPath = ''
    for (const [proj, sid] of Object.entries(peer.projectSessions || {})) {
      if (sid === sessionId) { projectPath = proj; break }
    }
    // 1) 先发一条可直接复制的跳转指令；2) 再发归属头 + 输出
    const jump = await jumpCommandLine(projectPath, sessionId)
    await outText(peerId, peer, '⚡ 回连本会话: ' + jump)
    const header = await sessionContextLine(sessionId, projectPath)
    await sendChunked(peerId, peer, header + '\n' + body)
  }
  const offSessionEvent = ctx.on('session/event', (session, event) => {
    try {
      if (!session || !session.id || !event || !event.type) return
      if (event.type === 'assistant/message') {
        const txt = extractText(event.data && event.data.message && event.data.message.content)
        if (txt) pendingText.set(session.id, (pendingText.get(session.id) || '') + (pendingText.get(session.id) ? '\n' : '') + txt)
      } else if (event.type === 'turn/end') {
        const txt = pendingText.get(session.id)
        pendingText.delete(session.id)
        if (!state.connected) return
        const found = findPeerBySession(session.id)
        if (!found) return
        if (!txt) {
          // 回合异常结束且无回复：把错误摘要推回微信，避免静默失败
          const reason = event.data && event.data.reason
          if (reason && reason.kind === 'error') {
            const msg = reason.error && (reason.error.message || reason.error.code) ? String(reason.error.message || reason.error.code) : String(reason.error || '')
            pushTurnResult(found.peerId, found.peer, session.id, '⚠ Agent 回合出错：' + clip(msg, 800))
          }
          return
        }
        pushTurnResult(found.peerId, found.peer, session.id, txt)
      }
    } catch (e) {
      log('session/event handler error:', e && (e.stack || e.message))
    }
  })

  // ---------- Agent 工具（自然语言项目查询/切换） ----------
  function defineTool(id, description, params) {
    const properties = {}
    const required = []
    for (const [k, v] of Object.entries(params)) {
      const copy = { ...v }
      if (copy.required) { required.push(k); delete copy.required }
      properties[k] = copy
    }
    return {
      name: id,
      description,
      parameters: { type: 'object', properties, required },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v ?? '') }] },
    }
  }
  const toolDefs = [
    defineTool('dsh_wc_projects', '列出 DSH 工作区全部项目（编号、名称、路径、是否绑定远程实验服务器）。微信对话中可用。', {}),
    defineTool('dsh_wc_status', '查询当前对话绑定的项目（cwd）与远程绑定状态。微信对话中可用。', {}),
    defineTool('dsh_wc_switch_project', '把当前对话切换到指定项目（按编号/名称/路径匹配）。切换后该对话的新消息会在新项目会话中处理。微信对话中可用。', {
      target: { type: 'string', description: '项目编号、名称或路径', required: true },
    }),
  ]
  for (const def of toolDefs) {
    ctx.tools.register({
      ...def,
      execute: async (args) => {
        try {
          const init = ctx.agents.currentInitiator()
          const found = init && init.id ? findPeerBySession(init.id) : null
          if (!found) return '当前会话未关联微信对话（该工具仅用于微信对话）。'
          const { peerId, peer } = found
          if (def.name === 'dsh_wc_projects') {
            const ps = listProjects()
            return ps.length
              ? ps.map((p, i) => (i + 1) + '. ' + p.title + ' | ' + p.path + (p.remote ? ' | 已绑定远程' : '')).join('\n')
              : '暂无项目'
          }
          if (def.name === 'dsh_wc_status') {
            const cur = peer.currentProject || ''
            return '当前项目: ' + (cur || '（无）') + (cur && existsSync(join(cur, '.dsh-remote.json')) ? '（已绑定远程）' : '') +
              '\n会话: ' + (peer.projectSessions[cur] || '（未建立）')
          }
          if (def.name === 'dsh_wc_switch_project') {
            const arg = String((args && args.target) || '').trim()
            if (!arg) return '用法: target 为项目编号/名称/路径（可用 dsh_wc_projects 查看列表）'
            const ps = listProjects()
            const n = parseInt(arg, 10)
            let target = null
            if (!Number.isNaN(n) && n >= 1 && n <= ps.length) target = ps[n - 1]
            else target = ps.find((p) => p.title === arg || p.path === arg || basename(p.path) === arg || (p.title || '').includes(arg) || p.path.includes(arg))
            if (!target) return '未找到项目: ' + arg + '。可用: ' + ps.map((p, i) => (i + 1) + '.' + p.title).join('、')
            peer.currentProject = target.path
            saveState(state)
            const sessionId = await ensureSession(peerId, target.path)
            return '✅ 已切换到项目 ' + target.title + '（' + target.path + '），该对话的新消息将在新会话 ' + sessionId + ' 中处理。'
          }
          return 'unknown tool'
        } catch (e) {
          return '工具执行失败: ' + String(e && e.message || e)
        }
      },
    })
  }

  // ---------- HTTP 路由（设置页数据面，仅回环） ----------
  function loopbackOnly(req) {
    const a = req && req.socket ? req.socket.remoteAddress : ''
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
  }
  function json(res, code, data) {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(data))
  }
  function readBody(req) {
    return new Promise((resolve) => {
      let b = ''
      req.on('data', (d) => {
        b += d
        if (b.length > 65536) { b = ''; try { req.destroy() } catch {} }
      })
      req.on('end', () => {
        try { resolve(b ? JSON.parse(b) : {}) } catch { resolve({}) }
      })
      req.on('error', () => resolve({}))
    })
  }
  function guard(req, res) {
    return loopbackOnly(req) ? null : json(res, 403, { error: 'loopback only' })
  }
  const routes = [
    ctx.webServer.register({
      kind: 'exact', path: '/api/dsh-wechat-channel/status',
      handler: (req, res) => {
        if (guard(req, res)) return
        const peers = Object.entries(state.peers).map(([peerId, p]) => ({
          peerId,
          project: p.currentProject || '',
          projectTitle: p.currentProject ? basename(p.currentProject) : '',
          sessionId: p.projectSessions[p.currentProject] || '',
          lastInboundAt: p.lastInboundAt || 0,
          lastOutboundAt: p.lastOutboundAt || 0,
        }))
        json(res, 200, {
          ok: true,
          connected: state.connected
            ? { accountId: state.connected.accountId, userId: state.connected.userId, connectedAt: state.connected.connectedAt }
            : null,
          login: loginSummary(),
          peers,
          projects: listProjects(),
        })
      },
    }),
    ctx.webServer.register({
      kind: 'exact', path: '/api/dsh-wechat-channel/login',
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        const r = await startLogin()
        return json(res, r.ok ? 200 : 400, r)
      },
    }),
    ctx.webServer.register({
      kind: 'exact', path: '/api/dsh-wechat-channel/verify',
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        const body = await readBody(req)
        if (!login) return json(res, 400, { error: '当前没有进行中的登录' })
        if (!body.code) return json(res, 400, { error: '缺少 code' })
        login.pendingVerifyCode = String(body.code).trim()
        login.phase = 'qr'
        login.message = '已提交验证码，等待确认…'
        return json(res, 200, { ok: true, login: loginSummary() })
      },
    }),
    ctx.webServer.register({
      kind: 'exact', path: '/api/dsh-wechat-channel/cancel-login',
      handler: (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        login = null
        return json(res, 200, { ok: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact', path: '/api/dsh-wechat-channel/logout',
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        if (login) login = null
        if (monitorAbort) { try { monitorAbort.abort() } catch {}; monitorAbort = null }
        if (state.connected) {
          notifyStop(state.connected.baseUrl, state.connected.botToken).catch(() => {})
          state.connected = null
          state.cursor = ''
          saveState(state)
        }
        return json(res, 200, { ok: true })
      },
    }),
    ctx.webServer.register({
      kind: 'exact', path: '/api/dsh-wechat-channel/switch',
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
        const body = await readBody(req)
        const peer = body.peerId ? state.peers[String(body.peerId)] : undefined
        if (!peer) return json(res, 400, { error: '对端不存在: ' + String(body.peerId) })
        const ps = listProjects()
        const target = ps.find((p) => p.path === body.project || p.title === body.project || basename(p.path) === body.project)
        if (!target) return json(res, 400, { error: '项目不存在: ' + String(body.project) })
        peer.currentProject = target.path
        saveState(state)
        const sessionId = await ensureSession(String(body.peerId), target.path)
        if (sessionId === null) {
          const mapped = peer.projectSessions[target.path]
          if (mapped && isArchivedSession(mapped)) {
            // 门控（硬拒绝）：不恢复已归档会话，并清除映射（UI 调用方已被告知）
            delete peer.projectSessions[target.path]
            saveState(state)
            return json(res, 400, { error: '该会话已归档（' + mapped + '），已拒绝恢复；请先 /session new 新建会话', archivedSessionId: mapped })
          }
          return json(res, 400, { error: '无法创建/恢复会话' })
        }
        return json(res, 200, { ok: true, project: target.path, sessionId })
      },
    }),
  ]

  // ---------- 启动恢复 ----------
  ;(async () => {
    if (!state.connected) return
    notifyStart(state.connected.baseUrl, state.connected.botToken).catch(() => {})
    startMonitor()
    const bootSelection = currentModelSelection()
    for (const [pid, peer] of Object.entries(state.peers)) {
      for (const [project, sid] of Object.entries(peer.projectSessions || {})) {
        if (isArchivedSession(sid)) { log('boot: skip archived session (gate):', sid); continue }
        if (ctx.agents.get(sid)) { attachToWorkspace(sid, project); continue } // 已 live（含 HMR 重载竞态窗口）
        try {
          const preset = await resolvePresetFor(sid)
          const bootSetup = makeAgentSetup(bootSelection, preset.mount)
          const handle = await ctx.agents.resume({ resumeSessionId: sid, setup: bootSetup })
          handles.set(sid, handle)
          attachToWorkspace(sid, project) // 幂等挂接：旧会话（含修复前创建的）也在 Web 端可见
        } catch (e) {
          const msg = e && e.message ? String(e.message) : String(e)
          if (msg.includes('while it is live') || msg.includes('cannot prepare')) {
            // HMR/竞态：旧实例 dispose 尚未完成 → 短暂等待后重试一次，仍失败则跳过
            // （下条消息会走 ensureSession 的 live 复用路径，会话不丢）
            await sleep(500)
            if (ctx.agents.get(sid)) { attachToWorkspace(sid, project); continue }
            try {
              const preset = await resolvePresetFor(sid)
              const bootSetup = makeAgentSetup(bootSelection, preset.mount)
              const handle = await ctx.agents.resume({ resumeSessionId: sid, setup: bootSetup })
              handles.set(sid, handle)
              attachToWorkspace(sid, project)
            } catch (e2) {
              log('boot resume retry failed (skip):', sid, e2 && e2.message)
            }
            continue
          }
          log('boot resume failed:', sid, e && e.message)
        }
      }
    }
    log('boot: resumed wechat channel, peers=' + Object.keys(state.peers).length)
  })().catch((e) => log('boot init error:', e && (e.stack || e.message)))

  // ---------- 卸载清理（所有副作用可逆） ----------
  ctx.effect(() => () => {
    try { offSessionEvent() } catch {}
    for (const r of routes) { try { r && r() } catch {} }
    if (login) login = null
    if (monitorAbort) { try { monitorAbort.abort() } catch {} }
    if (state.connected) notifyStop(state.connected.baseUrl, state.connected.botToken).catch(() => {})
    // HMR 热重载安全：绝不 dispose 会话 agent——否则每次代码编辑都会杀死正在对话的会话
    // （事故根因）。会话由新实例 boot/ensureSession 经 ctx.agents.get 收养继续使用，
    // 进程退出时由宿主统一清理。
    handles.clear()
    pendingText.clear()
    log('disposed (agents kept alive for hot-reload adoption)')
  })
}
