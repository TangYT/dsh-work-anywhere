/**
 * dsh-remote-lab — 项目 ↔ 远程工作区绑定 + 回调驱动实验计划引擎（host 插件）。
 *
 * 模型（v0.3）：每个项目目录通过根目录下的 .dsh-remote.json 绑定一个远程工作区
 * （服务器别名 + 远端根目录 + webhook）。改服务器配置或换绑只需改这个文件/在设置页
 * 重新选择服务器。工具默认按「当前会话所在项目」严格解析绑定：先确定会话所属项目根
 * （已注册工作区的最长匹配），绑定只在项目根目录读取（子目录自动归属项目根），
 * 绝不跨项目继承祖先绑定；也可显式传 name（legacy 全局工作区名或项目绝对路径）。
 *
 * 回调监控：实验命令之后追加 callback 段（wrapper 脚本），完成瞬间由 ssh2 通道关闭
 * 事件触发 DSH 执行后续处理（状态落盘 → 产物下载 → webhook 通知 → 唤醒发起会话的
 * Agent → 可选 auto-chain 启动下一实验），全程零轮询。断线后实验继续运行（setsid），
 * 重启扫描 running/detached 并重挂 watcher（远端 tail --pid 事件驱动等待）。
 *
 * 传输层：ssh2。SSH 主机配置复用 dsh-ssh 插件的 $DSH_HOME/dsh-ssh.json。
 */
import { Client } from 'ssh2'
import { createNetLayer } from './net.js'
import { createGitRunner, formatGitResult } from './local-git.js'
import { createDownloader } from './download.js'
import { createArxivReader } from './arxiv.js'
import { readFile, writeFile, mkdir, unlink, readdir, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve, basename, sep } from 'node:path'

export const name = 'remote-lab'
export const inject = ['tools', 'systemPrompt', 'webServer']

// legacy：旧版全局工作区根（显式 name 时仍可读写，向后兼容）
const LAB_ROOT = process.env.REMLAB_ROOT || join(homedir(), 'remote-lab')
const SSH_CONFIG_PATH = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'dsh-ssh.json')
  : join(homedir(), '.dsh', 'dsh-ssh.json')

// 插件级配置（git 安全策略 / HF token）与 git 审计日志：DSH_HOME/work-anywhere/ 下
const WA_CONFIG_PATH = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'work-anywhere', 'config.json')
  : join(homedir(), '.dsh', 'work-anywhere', 'config.json')
const GIT_AUDIT_PATH = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'work-anywhere', 'git-audit.jsonl')
  : join(homedir(), '.dsh', 'work-anywhere', 'git-audit.jsonl')

// 目录名校验：允许空格与 CJK 等普通字符（远端命令一律用双引号包裹路径，空格安全）；
// 仅拒绝在双引号内仍具特殊含义的字符（" $ ` 与控制字符），防止路径展开/注入。
export function validateWsName(name) {
  if (!name || name.length > 60) return '项目目录名为空或过长（当前: ' + name + '）'
  if (/[\u0000-\u001f"$`]/.test(name)) return '项目目录名包含 shell 特殊字符（" $ ` 或控制字符），请重命名（当前: ' + name + '）'
  return null
}
export function validateRemoteRoot(root) {
  if (!root || root.length > 500) return 'remoteRoot 为空或过长'
  if (/[\u0000-\u001f"$`]/.test(root)) return 'remoteRoot 包含 shell 特殊字符（" $ ` 或控制字符）'
  return null
}
// dsh-ssh.json 主机条目 → 插件内部连接配置：必须透传 password 认证（否则密码认证主机无法连接）
export function normalizeSshHost(h) {
  const auth = (h && h.auth) || {}
  return {
    host: h && h.host,
    port: h && h.port ? h.port : 22,
    user: h && h.user,
    keyPath: auth.keyPath || undefined,
    passphrase: auth.passphrase || undefined,
    password: auth.password || undefined,
  }
}
// 严格项目作用域下为会话 cwd 挑选绑定：仅 cwd 本身是绑定目录，或 cwd 的已注册工作区根是绑定目录。
// rootPath 传 workspaceRegistry 解析出的项目根（不可用时传 undefined → 仅精确目录命中，绝不向上继承）。
export function pickBindingForCwd(bindings, cwd, rootPath) {
  if (!cwd) return undefined
  const isWin = process.platform === 'win32'
  const norm = (p) => {
    const r = resolve(p).replace(/[\\/]+$/, '')
    return (isWin ? r.toLowerCase() : r)
  }
  const n = norm(cwd)
  const nr = rootPath ? norm(rootPath) : undefined
  let best
  for (const b of bindings || []) {
    if (!b || !b.path) continue
    const p = norm(b.path)
    if (n === p) return b
    if (nr !== undefined && p === nr) {
      if (!best || p.length > norm(best.path).length) best = b
    }
  }
  return best
}
// 一次性服务器速查文案：只包含该会话项目绑定的那一台服务器，绝不列出其他主机（隐私约束）。
export function buildServerContextLine(binding) {
  const h = (binding && binding.host) || {}
  const alias = binding && binding.alias
  const path = binding && binding.path
  const root = binding && binding.remoteRoot
  const parts = []
  parts.push('【远程服务器】本会话项目' + (path ? '「' + basename(path) + '」' : '') + '绑定远程服务器：' + alias)
  if (h.host) parts.push(h.host + ':' + (h.port || 22) + '（用户 ' + (h.user || '?') + '，' + (h.auth === 'password' ? '密码认证' : '密钥认证') + '）')
  if (root) parts.push('远端根目录 ' + root)
  parts.push('你之后提及「远程服务器/那台机器/服务器别名」等即指该服务器（本会话仅此一台）')
  return parts.join('；').replace(/；；/g, '；')
}

// HMR 热重载探针: v0.2.0-hmr1
export function apply(ctx) {
  // 服务惰性获取：插件应用顺序/服务初始化时序可能导致 apply 时 ctx.get 尚未就绪，
  // 缓存 undefined 会永久失效；每次使用时重新尝试获取一次。
  let agents = ctx.get('agents')
  let workspaceRegistry = ctx.get('workspaceRegistry')
  function ensureServices() {
    if (agents === undefined) agents = ctx.get('agents')
    if (workspaceRegistry === undefined) workspaceRegistry = ctx.get('workspaceRegistry')
  }

  let sshHosts = null
  // 每会话一次性「远程服务器速查」注入（agent/session-start 时注入一条，之后不再重复）：
  // serverCache.bindings = [{path, alias, remoteRoot, host?}]，只缓存、不含凭据。
  const serverCache = { bindings: null }
  async function refreshServerCache() {
    ensureServices()
    const hosts = await loadSshHosts()
    const list = []
    const seen = new Set()
    const push = (dir, cfg) => {
      if (!dir || !cfg || !cfg.alias) return
      const key = resolve(dir)
      if (seen.has(key)) return
      seen.add(key)
      const h = hosts[cfg.alias]
      list.push({
        path: dir,
        alias: cfg.alias,
        remoteRoot: cfg.remoteRoot || '',
        host: h ? { host: h.host, port: h.port, user: h.user, auth: h.password ? 'password' : 'key' } : undefined,
      })
    }
    try {
      if (workspaceRegistry && typeof workspaceRegistry.list === 'function') {
        for (const w of workspaceRegistry.list()) {
          if (!w || !w.path) continue
          const cfg = await loadBindingConfig(w.path)
          if (cfg) push(w.path, cfg)
        }
      }
    } catch (e) { log('server cache workspace scan failed:', e && e.message) }
    if (existsSync(LAB_ROOT)) {
      try {
        for (const n of await readdir(LAB_ROOT)) {
          const d = legacyDir(n)
          const cfg = await loadBindingConfig(d)
          if (cfg) push(d, cfg)
        }
      } catch (e) { log('server cache legacy scan failed:', e && e.message) }
    }
    serverCache.bindings = list
    log('server cache refreshed: ' + list.length + ' bindings')
  }
  function bindingHitForCwd(cwd) {
    const list = serverCache.bindings
    if (!list) return undefined
    ensureServices()
    let root
    try { root = workspaceRootOf(cwd) } catch { root = undefined }
    return pickBindingForCwd(list, cwd, root)
  }
  function tryInjectServerContext(agent, binding) {
    try {
      agent.inject({
        id: 'remlab-server-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
        role: 'user',
        content: [{ type: 'text', text: buildServerContextLine(binding) }],
        source: { kind: 'user' },
      })
      log('server context injected into ' + agent.id + ': ' + binding.alias)
    } catch (e) { log('agent.inject failed:', e && e.message) }
  }
  function injectServerContext(agent) {
    try {
      const s = agent && agent.session
      const cwd = s && (s.cwd || (s.header && s.header.cwd) || (s.meta && s.meta.cwd))
      if (!cwd) return
      const hit = bindingHitForCwd(cwd)
      if (hit !== undefined) { tryInjectServerContext(agent, hit); return }
      // 缓存未命中（未就绪或绑定文件刚变化）：刷新后重查并尽力注入
      refreshServerCache().then(() => {
        const late = bindingHitForCwd(cwd)
        if (late) tryInjectServerContext(agent, late)
      }).catch((e) => log('server cache refresh failed:', e && e.message))
    } catch (e) { log('server context inject failed:', e && e.message) }
  }
  const watchers = new Map()
  const debugLog = []
  function log(line) {
    const entry = new Date().toISOString() + ' ' + line
    debugLog.push(entry)
    if (debugLog.length > 200) debugLog.shift()
    console.log('remote-lab: ' + entry)
  }
  // 网络权限层：直连优先；直连失败自动扫描本地代理（环境变量→系统代理→常见 Clash 端口）回退
  const net = createNetLayer({ fetchImpl: (url, opts) => fetch(url, opts), log })

  // ---------- 插件配置 / 审计 / git 执行器 / 大文件下载器 ----------
  const waConfig = { git: { pushApproval: false, restrictPaths: false }, hfToken: '' }
  async function loadWaConfig() {
    const raw = await readTextIfExists(WA_CONFIG_PATH)
    if (!raw) return
    try {
      const cfg = JSON.parse(raw)
      if (cfg && typeof cfg === 'object') {
        if (cfg.git && typeof cfg.git === 'object') {
          waConfig.git.pushApproval = cfg.git.pushApproval === true
          waConfig.git.restrictPaths = cfg.git.restrictPaths === true
        }
        if (typeof cfg.hfToken === 'string') waConfig.hfToken = cfg.hfToken
      }
    } catch (e) { log('wa config load failed: ' + String(e && e.message || e)) }
  }
  async function saveWaConfig() {
    try {
      await mkdir(dirname(WA_CONFIG_PATH), { recursive: true })
      await writeFile(WA_CONFIG_PATH, JSON.stringify(waConfig, null, 2), 'utf8')
    } catch (e) { log('wa config save failed: ' + String(e && e.message || e)) }
  }
  // 会话缺省工作目录：workspaceRegistry 解析出的项目根，否则 cwd 本身
  async function gitDefaultCwd() {
    const cwd = await sessionCwd()
    if (!cwd) return undefined
    return workspaceRootOf(cwd) || cwd
  }
  const gitRunner = createGitRunner({
    discoverProxy: () => net.discoveredProxy(),
    policy: () => ({
      restrictPaths: waConfig.git.restrictPaths === true,
      allowedRoots: (() => {
        ensureServices()
        try { return (workspaceRegistry?.list() || []).map((w) => w && w.path).filter(Boolean) } catch { return [] }
      })(),
      pushApproval: waConfig.git.pushApproval === true,
    }),
    requestPushApproval: async ({ args, cwd }) => {
      ensureServices()
      const approval = ctx.get('approval')
      const agent = agents && agents.currentInitiator()
      if (!approval || !agent) return false
      try {
        const outcome = await approval.request({
          agent,
          toolName: 'dwa_git',
          reason: 'git push（cwd: ' + cwd + '，命令: ' + args.join(' ').slice(0, 160) + '）',
          signal: AbortSignal.timeout(600000),
        })
        return outcome === 'allowed-once'
      } catch (e) { log('push approval failed: ' + String(e && e.message || e)); return false }
    },
    audit: (rec) => {
      appendFile(GIT_AUDIT_PATH, JSON.stringify(rec) + '\n', 'utf8').catch(() => {})
    },
    sessionRoot: () => process.cwd(),
    log,
  })
  const downloader = createDownloader({
    netLayer: net,
    sessionRoot: () => process.cwd(),
    cfg: () => ({
      restrictPaths: waConfig.git.restrictPaths === true,
      allowedRoots: (() => {
        ensureServices()
        try { return (workspaceRegistry?.list() || []).map((w) => w && w.path).filter(Boolean) } catch { return [] }
      })(),
    }),
    log,
  })
  const arxivReader = createArxivReader({ netLayer: net, log })

  // ---------- 本地文件 / 绑定解析 ----------
  async function readTextIfExists(path) {
    try { return await readFile(path, 'utf8') } catch { return undefined }
  }
  async function writeJson(path, obj) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(obj, null, 2), 'utf8')
  }
  function bindingFile(dir) { return join(dir, '.dsh-remote.json') }
  function legacyDir(n) { return join(LAB_ROOT, n) }
  function planFileOf(dir) { return join(dir, '.remote-lab', 'plan.json') }
  async function loadBindingConfig(dir) {
    const raw = (await readTextIfExists(bindingFile(dir))) ?? (await readTextIfExists(join(dir, 'remote.json')))
    if (!raw) return undefined
    try { return JSON.parse(raw) } catch { return undefined }
  }
  const isWin = process.platform === 'win32'
  function normPath(p) {
    const r = resolve(p)
    const stripped = r.replace(/[\\/]+$/, '')
    return stripped || r
  }
  function samePath(a, b) {
    const x = normPath(a)
    const y = normPath(b)
    return isWin ? x.toLowerCase() === y.toLowerCase() : x === y
  }
  // 会话所属项目根：workspaceRegistry 中「cwd 自身或其祖先」的最长匹配
  function workspaceRootOf(cwd) {
    ensureServices()
    if (!workspaceRegistry) return undefined
    let ws = []
    try { ws = workspaceRegistry.list() || [] } catch { ws = [] }
    const norm = normPath(cwd)
    const cmpN = isWin ? norm.toLowerCase() : norm
    let best
    for (const w of ws) {
      if (!w || !w.path) continue
      const p = normPath(w.path)
      const cmpP = isWin ? p.toLowerCase() : p
      if (cmpN === cmpP) return p
      if (cmpN.startsWith(cmpP + sep)) {
        if (!best || p.length > best.length) best = p
      }
    }
    return best
  }
  // 项目内绑定查找：从 fromDir 向上至 projectRoot（含）为止，绝不越过项目根
  async function findBindingWithin(fromDir, projectRoot) {
    let cur = normPath(fromDir)
    const stop = normPath(projectRoot)
    for (;;) {
      const cfg = await loadBindingConfig(cur)
      if (cfg) return { dir: cur, cfg }
      if (samePath(cur, stop)) return undefined
      const parent = dirname(cur)
      if (parent === cur) return undefined
      cur = parent
    }
  }
  async function sessionCwd() {
    ensureServices()
    if (!agents) return undefined
    try {
      const a = agents.currentInitiator()
      const s = a && a.session
      return s && (s.cwd || (s.header && s.header.cwd) || (s.meta && s.meta.cwd))
    } catch { return undefined }
  }
  // 绑定解析（严格按项目，杜绝跨项目继承）：
  // 1) 显式 name = 项目绝对路径 → 仅该目录本身（绝不向上继承祖先绑定）
  // 2) 显式 name = legacy 全局工作区名 → 仅该 legacy 目录（必须显式指定）
  // 3) 显式 name = 当前项目名匹配 → 当前会话所属项目根
  // 4) 缺省 → 先定位会话所属项目根（已注册工作区最长匹配），在 cwd→项目根 范围内查找；
  //    注册表不可用/会话未注册时退化为仅精确检查 cwd 自身（项目根绑定文件在 cwd 的
  //    常见情形仍可用），绝不向上继承祖先目录的绑定。
  async function resolveWs(args) {
    ensureServices()
    if (args && typeof args.name === 'string' && args.name) {
      if (/^[A-Za-z]:[\\/]|[\\/]/.test(args.name)) {
        const dir = resolve(args.name)
        const cfg = await loadBindingConfig(dir)
        return cfg ? { dir, cfg } : undefined
      }
      const legacyCfg = await loadBindingConfig(legacyDir(args.name))
      if (legacyCfg) return { dir: legacyDir(args.name), cfg: legacyCfg }
      const cwd = await sessionCwd()
      if (cwd) {
        const root = workspaceRootOf(cwd)
        if (root) {
          const b = await findBindingWithin(cwd, root)
          if (b && (b.cfg.name === args.name || basename(b.dir) === args.name)) return b
        }
      }
      return undefined
    }
    const cwd = await sessionCwd()
    if (!cwd) return undefined
    const root = workspaceRootOf(cwd)
    // root 存在 → 项目内查找；root 未知（注册表不可用/未注册会话）→ 仅精确检查 cwd 自身
    return findBindingWithin(cwd, root || cwd)
  }
  async function loadPlan(dir) {
    const raw = await readTextIfExists(planFileOf(dir))
    if (!raw) return undefined
    try { return JSON.parse(raw) } catch { return undefined }
  }
  async function savePlan(dir, plan) { await writeJson(planFileOf(dir), plan) }
  function expLocalDir(dir, id) { return join(dir, '.remote-lab', 'experiments', id) }
  // 按会话 id 解析其项目目录（浏览器请求无工具上下文，须由 host 侧查询）
  async function sessionCwdById(sessionId) {
    ensureServices()
    try {
      if (agents) {
        const a = agents.get(sessionId)
        const s = a && a.session
        const cwd = s && (s.cwd || (s.header && s.header.cwd) || (s.meta && s.meta.cwd))
        if (cwd) return cwd
      }
    } catch {}
    try {
      const sq = ctx.get('sessionQuery')
      if (sq && typeof sq.readSession === 'function') {
        const snap = await sq.readSession(sessionId)
        const cwd = snap && ((snap.meta && snap.meta.cwd) || (snap.header && snap.header.cwd))
        if (cwd) return cwd
      }
    } catch (e) { log('sessionQuery lookup failed: ' + String(e && e.message || e)) }
    return undefined
  }

  // ---------- SSH 主机配置 ----------
  async function loadSshHosts() {
    if (sshHosts) return sshHosts
    sshHosts = {}
    try {
      const text = await readTextIfExists(SSH_CONFIG_PATH)
      if (text) {
        const cfg = JSON.parse(text)
        for (const h of (cfg.hosts || [])) {
          sshHosts[h.alias] = normalizeSshHost(h)
        }
      }
    } catch (e) { log('ssh config load failed: ' + String(e && e.message || e)) }
    return sshHosts
  }

  // ---------- ssh2 连接 ----------
  function newClient(h) {
    const client = new Client()
    client.on('error', () => {})
    return client
  }
  async function connect(h) {
    const client = newClient(h)
    let keyText = ''
    if (h.keyPath) { try { keyText = await readFile(h.keyPath, 'utf8') } catch (e) { log('key read failed: ' + String(e && e.message || e)) } }
    await new Promise((resolve, reject) => {
      const onReady = () => { client.removeListener('error', onErr); resolve(client) }
      const onErr = (err) => { client.removeListener('ready', onReady); reject(err) }
      client.once('ready', onReady)
      client.once('error', onErr)
      client.connect({
        host: h.host,
        port: h.port,
        username: h.user,
        privateKey: keyText || undefined,
        passphrase: h.passphrase || undefined,
        password: h.password || undefined,
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        hostVerifier: () => true,
      })
    })
    return client
  }
  function execOn(client, cmd, opts = {}) {
    return new Promise((resolve) => {
      const maxOut = opts.maxBytes || 262144
      client.exec(cmd, (err, stream) => {
        if (err) return resolve({ exitCode: null, stdout: '', stderr: '', error: String(err && err.message || err) })
        let stdout = '', stderr = ''
        stream.on('data', (d) => { stdout += d.toString('utf8'); if (stdout.length > maxOut) stdout = stdout.slice(-maxOut) })
        stream.stderr.on('data', (d) => { stderr += d.toString('utf8'); if (stderr.length > 65536) stderr = stderr.slice(-65536) })
        stream.on('close', (code) => resolve({ exitCode: code, stdout, stderr, error: '' }))
      })
    })
  }
  function execWithStdin(client, cmd, stdinData, opts = {}) {
    return new Promise((resolve) => {
      const maxOut = opts.maxBytes || 262144
      client.exec(cmd, (err, stream) => {
        if (err) return resolve({ exitCode: null, stdout: '', stderr: '', error: String(err && err.message || err) })
        let stdout = '', stderr = ''
        stream.on('data', (d) => { stdout += d.toString('utf8'); if (stdout.length > maxOut) stdout = stdout.slice(-maxOut) })
        stream.stderr.on('data', (d) => { stderr += d.toString('utf8'); if (stderr.length > 65536) stderr = stderr.slice(-65536) })
        if (stdinData !== undefined) stream.end(stdinData)
        stream.on('close', (code) => resolve({ exitCode: code, stdout, stderr, error: '' }))
      })
    })
  }
  async function runSsh(h, cmd, opts = {}) {
    let client
    try { client = await connect(h) } catch (e) { return { exitCode: null, stdout: '', stderr: '', error: String(e && e.message || e) } }
    try {
      return opts.stdin !== undefined ? await execWithStdin(client, cmd, opts.stdin, opts) : await execOn(client, cmd, opts)
    } finally {
      try { client.end() } catch {}
      try { client.destroy() } catch {}
    }
  }
  // 绑定级远端执行：配置了 sudoPassword 时经 sudo -S 提升权限（该绑定下所有命令以 root 运行）。
  // 注意：sudo 无法执行 shell 内建（cd/管道/$(...)），故统一经 bash -lc 包裹执行完整 shell 命令。
  function shQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'" }
  function sudoWrap(ws, cmd) { return ws.sudoPassword ? 'sudo -S -p "" bash -lc ' + shQuote(cmd) : cmd }
  function sudoStdin(ws) { return ws.sudoPassword ? ws.sudoPassword + '\n' : undefined }
  async function runWs(ws, cmd, opts = {}) {
    const hosts = await loadSshHosts()
    const h = hosts[ws.alias]
    if (!h) return { exitCode: null, stdout: '', stderr: '', error: 'alias not found: ' + ws.alias }
    return runSsh(h, sudoWrap(ws, cmd), { ...opts, stdin: sudoStdin(ws) })
  }
  function execWatch(h, cmd, stdinData, record, onDone) {
    connect(h).then(client => {
      let settled = false
      const finish = (code, stdout) => {
        if (settled) return
        settled = true
        try { client.end() } catch {}
        try { client.destroy() } catch {}
        onDone(code, stdout)
      }
      client.on('close', () => finish(null, ''))
      client.on('error', () => finish(null, ''))
      client.exec(cmd, (err, stream) => {
        if (err) return finish(null, String(err && err.message || err))
        let stdout = ''
        stream.on('data', (d) => { stdout += d.toString('utf8'); if (stdout.length > 524288) stdout = stdout.slice(-524288) })
        stream.stderr.resume()
        if (stdinData !== undefined) stream.end(stdinData)
        stream.on('close', (code) => finish(code, stdout))
      })
    }).catch(err => onDone(null, String(err && err.message || err)))
  }
  function sftpMkdirs(sftp, dir) {
    return new Promise((resolve) => {
      const parts = dir.split('/').filter(Boolean)
      let cur = ''
      const step = (i) => {
        if (i >= parts.length) return resolve()
        cur += '/' + parts[i]
        sftp.mkdir(cur, () => step(i + 1))
      }
      step(0)
    })
  }
  async function uploadRemoteFile(ws, remotePath, content, mode) {
    const hosts = await loadSshHosts()
    const h = hosts[ws.alias]
    if (!h) return { exitCode: null, err: 'alias not found: ' + ws.alias }
    let client
    try { client = await connect(h) } catch (e) { return { exitCode: null, err: String(e && e.message || e) } }
    try {
      if (ws.sudoPassword) {
        // sudo 路径：exec 一次性写入（密码 + 内容经 stdin），可写 root 属主目录
        const dir = dirname(remotePath)
        const sh = 'umask 077; mkdir -p \'' + dir.replace(/'/g, "'\\''") + '\' && cat > \'' + remotePath.replace(/'/g, "'\\''") + '\' && chmod ' + ((mode == null ? 0o755 : mode).toString(8)) + ' \'' + remotePath.replace(/'/g, "'\\''") + '\' && echo UPLOAD_OK'
        const r = await execWithStdin(client, 'sudo -S -p "" sh -c \'' + sh + '\'', ws.sudoPassword + '\n' + content, { maxBytes: 65536 })
        if (!/UPLOAD_OK/.test(r.stdout)) return { exitCode: null, err: (r.stderr || r.error || 'sudo upload failed').slice(-300) }
        return { exitCode: 0, err: '' }
      }
      await new Promise((resolve, reject) => {
        client.sftp((err, sftp) => {
          if (err) return reject(err)
          sftpMkdirs(sftp, dirname(remotePath)).then(() => {
            sftp.writeFile(remotePath, content, { mode: mode || 0o755 }, (e2) => {
              sftp.end()
              e2 ? reject(e2) : resolve()
            })
          }).catch(reject)
        })
      })
      return { exitCode: 0, err: '' }
    } catch (e) {
      return { exitCode: null, err: String(e && e.message || e) }
    } finally {
      try { client.end() } catch {}
      try { client.destroy() } catch {}
    }
  }
  async function downloadRemoteFile(ws, remotePath, localPath) {
    const hosts = await loadSshHosts()
    const h = hosts[ws.alias]
    if (!h) return { ok: false, err: 'alias not found: ' + ws.alias }
    let client
    try { client = await connect(h) } catch (e) { return { ok: false, err: String(e && e.message || e) } }
    try {
      await mkdir(dirname(localPath), { recursive: true })
      if (ws.sudoPassword) {
        // sudo 路径：base64 经 stdout 拉取（二进制安全），上限 64MiB
        const r = await execWithStdin(client, 'sudo -S -p "" base64 \'' + remotePath.replace(/'/g, "'\\''") + '\'', ws.sudoPassword + '\n', { maxBytes: 64 * 1024 * 1024 })
        if (r.exitCode !== 0) return { ok: false, err: (r.stderr || r.error || 'sudo download failed').slice(-200) }
        await writeFile(localPath, Buffer.from(r.stdout.trim(), 'base64'))
        return { ok: true, err: '' }
      }
      await new Promise((resolve, reject) => {
        client.sftp((err, sftp) => {
          if (err) return reject(err)
          sftp.fastGet(remotePath, localPath, (e2) => { sftp.end(); e2 ? reject(e2) : resolve() })
        })
      })
      return { ok: true, err: '' }
    } catch (e) {
      return { ok: false, err: String(e && e.message || e) }
    } finally {
      try { client.end() } catch {}
      try { client.destroy() } catch {}
    }
  }

  // ---------- 远端脚本模板（实验命令之后追加 callback 段） ----------
  function qsh(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') }
  function buildWrapper(exp, stateDir, cmdDir) {
    const b64 = Buffer.from(exp.command, 'utf8').toString('base64')
    const L = []
    L.push('#!/usr/bin/env bash')
    L.push('set -u')
    L.push('STATE_DIR="' + qsh(stateDir) + '"')
    L.push('WORK_DIR="' + qsh(cmdDir) + '"')
    L.push('LOG="$STATE_DIR/stdout.log"')
    L.push('RESULT="$STATE_DIR/result.json"')
    L.push('mkdir -p "$STATE_DIR" "$WORK_DIR" || exit 90')
    L.push('cd "$WORK_DIR" || exit 91')
    L.push('date -Is > "$STATE_DIR/started_at"')
    if (exp.gpus !== undefined && exp.gpus !== null && String(exp.gpus) !== '') L.push('export CUDA_VISIBLE_DEVICES="' + qsh(String(exp.gpus)) + '"')
    const env = exp.env || {}
    for (const k of Object.keys(env)) L.push('export ' + k + '="' + qsh(String(env[k])) + '"')
    L.push("CMD_B64='" + b64 + "'")
    L.push("CMD=\"$(printf '%s' \"$CMD_B64\" | base64 -d 2>/dev/null || printf '%s' \"$CMD_B64\" | python3 -c 'import sys,base64;sys.stdout.write(base64.b64decode(sys.stdin.read().strip()).decode())')\"")
    L.push('if command -v setsid >/dev/null 2>&1; then setsid bash -lc "$CMD" > "$LOG" 2>&1 < /dev/null & else nohup bash -lc "$CMD" > "$LOG" 2>&1 < /dev/null & fi')
    L.push('PID=$!')
    L.push('echo "$PID" > "$STATE_DIR/pid"')
    L.push('echo "STARTED pid=$PID"')
    if (exp.timeoutSec && exp.timeoutSec > 0) {
      L.push('( sleep ' + Math.floor(exp.timeoutSec) + '; kill -- "-$PID" 2>/dev/null || kill "$PID" 2>/dev/null ) > /dev/null 2>&1 < /dev/null & WATCH=$!')
    } else {
      L.push('WATCH=')
    }
    L.push('wait "$PID"')
    L.push('CODE=$?')
    L.push('[ -n "$WATCH" ] && kill "$WATCH" 2>/dev/null || true')
    L.push('printf "{\\n  \\"exitCode\\": %s,\\n  \\"finishedAt\\": \\"%s\\",\\n  \\"elapsedSec\\": %s\\n}\\n" "$CODE" "$(date -Is)" "$SECONDS" > "$RESULT"')
    L.push('echo "RESULT_BEGIN"')
    L.push('cat "$RESULT"')
    L.push('echo "RESULT_END"')
    L.push('echo "DONE ' + exp.id + ' code=$CODE"')
    L.push('exit 0')
    return L.join('\n')
  }
  function buildAttachScript(stateDir, expId) {
    const L = []
    L.push('set -u')
    L.push('PID="$(cat "' + qsh(stateDir) + '/pid" 2>/dev/null || echo 0)"')
    L.push('if [ "$PID" = "0" ] || ! kill -0 "$PID" 2>/dev/null; then echo "ATTACH_DEAD pid=$PID"; exit 3; fi')
    L.push('echo "ATTACHED pid=$PID"')
    L.push('if tail --pid "$PID" -f /dev/null 2>/dev/null; then :; else while kill -0 "$PID" 2>/dev/null; do sleep 5; done; fi')
    L.push('for _i in $(seq 1 20); do [ -f "' + qsh(stateDir) + '/result.json" ] && break; sleep 0.25; done')
    L.push("CODE=\"$(sed -n 's/.*\"exitCode\": *\\(-\\{0,1\\}[0-9]\\{1,\\}\\).*/\\1/p' \"" + qsh(stateDir) + '/result.json" 2>/dev/null | head -1)"')
    L.push('[ -z "$CODE" ] && CODE=-99')
    L.push('echo "RESULT_BEGIN"')
    L.push('cat "' + qsh(stateDir) + '/result.json" 2>/dev/null || echo "{}"')
    L.push('echo "RESULT_END"')
    L.push('echo "DONE ' + expId + ' code=$CODE"')
    L.push('exit 0')
    return L.join('\n')
  }

  async function remoteExpAlive(ws, expId) {
    const pidPath = ws.remoteRoot + '/.remote-lab/experiments/' + expId + '/pid'
    const r = await runWs(ws, 'p=$(cat "' + pidPath + '" 2>/dev/null) && [ -n "$p" ] && kill -0 "$p" 2>/dev/null && echo ALIVE || echo DEAD')
    if (r.error) { log('remoteExpAlive(' + expId + ') transport failed: ' + r.error.slice(0, 120)); return 'unknown' }
    return /ALIVE/.test(r.stdout)
  }
  // 相对路径净化：拒绝包含 .. 段与绝对前缀的路径，防止越过项目/工作区边界
  function safeRel(rel) {
    const s = String(rel).replace(/\\/g, '/').replace(/^\/+/, '')
    if (!s || s.split('/').some((seg) => seg === '..')) return null
    return s
  }
  async function pullRemoteFiles(ws, dir, rels) {
    const results = []
    for (const rel of rels) {
      const okRel = safeRel(rel)
      if (okRel === null) {
        results.push({ rel, ok: false, err: '非法路径（拒绝 .. 与绝对路径）' })
        continue
      }
      const remotePath = ws.remoteRoot + '/' + okRel
      const localPath = join(dir, okRel)
      const r = await downloadRemoteFile(ws, remotePath, localPath)
      results.push({ rel: okRel, ok: r.ok, err: r.err.slice(-200) })
    }
    return results
  }

  // ---------- 通知 / 唤醒 ----------
  function buildWebhookBody(kind, text) {
    if (kind === 'wecom') return JSON.stringify({ msgtype: 'text', text: { content: text } })
    return JSON.stringify({ msg_type: 'text', content: { text } })
  }
  async function notifyWebhook(ws, payload) {
    const url = ws.notifyWebhook
    if (!url) return
    const kind = ws.notifyKind === 'wecom' ? 'wecom' : 'feishu'
    const text = '[remote-lab] ' + payload.event + ' | ws=' + payload.name + ' | exp=' + payload.expId + (payload.exitCode !== null && payload.exitCode !== undefined ? ' | exit=' + payload.exitCode : '') + (payload.goal ? ' | plan: ' + String(payload.goal).slice(0, 60) : '')
    try {
      await net.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildWebhookBody(kind, text),
        signal: AbortSignal.timeout(20000),
      })
    } catch (e) { log('webhook failed: ' + String(e && e.message || e)) }
  }
  function wakeAgent(sessionId, ws, plan, exp, status, exitCode, downloadNote, dir) {
    ensureServices()
    if (!agents || !sessionId) return
    let agent
    try { agent = agents.get(sessionId) } catch { agent = undefined }
    if (!agent || typeof agent.followup !== 'function') return
    const lines = []
    lines.push('【remote-lab 实验回调】' + status + ' | 项目 ' + basename(dir) + ' → ' + ws.name + '（' + ws.alias + '）')
    lines.push('计划: ' + (plan.goal || plan.planId) + ' | 模式: ' + plan.mode)
    lines.push('实验: ' + exp.name + '（' + exp.id + '）' + (exitCode !== null && exitCode !== undefined ? ' exit=' + exitCode : '') + (exp.timeoutSec && exitCode === 143 ? '（疑似超时被杀）' : ''))
    lines.push('本地结果目录: ' + expLocalDir(dir, exp.id))
    if (downloadNote) lines.push(downloadNote)
    if (plan.mode === 'auto-chain') lines.push('auto-chain 模式：下一个 pending 实验已由插件自动启动（如有）；请在本轮给出简短评审/备注。')
    else lines.push('请继续推进实验计划：先分析结果（remlab_experiment_collect / remlab_plan_status），再决定下一步（remlab_experiment_launch）。')
    try {
      agent.followup({ id: 'remlab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), role: 'user', content: [{ type: 'text', text: lines.join('\n') }], source: { kind: 'user' } })
    } catch (e) { log('wakeAgent failed: ' + String(e && e.message || e)) }
  }

  // ---------- 实验生命周期 ----------
  async function launchExperiment(rsv, exp) {
    const { dir, cfg: ws } = rsv
    const df = await runWs(ws, 'df -Pk "' + ws.remoteRoot + '" 2>/dev/null | tail -1')
    const dfm = /(\d+)%/.exec(df.stdout)
    if (dfm && parseInt(dfm[1], 10) > 95) return { ok: false, error: '远端磁盘使用率 ' + dfm[1] + '% 已超 95%，拒绝启动实验（请先清理磁盘）' }
    const stateDir = ws.remoteRoot + '/.remote-lab/experiments/' + exp.id
    if (exp.cwd && safeRel(exp.cwd) === null) return { ok: false, error: '实验 cwd 非法（拒绝 .. 与绝对路径，仅限工作区内子目录）' }
    const cmdDir = ws.remoteRoot + (exp.cwd ? '/' + safeRel(exp.cwd) : '')
    const up = await uploadRemoteFile(ws, stateDir + '/wrapper.sh', buildWrapper(exp, stateDir, cmdDir))
    if (up.exitCode !== 0) return { ok: false, error: 'wrapper upload failed: ' + up.err.slice(0, 200) }
    const sessionId = agents && agents.currentInitiator() ? agents.currentInitiator().id : undefined
    const record = { dir, cfg: ws, expId: exp.id, sessionId, kind: 'launch', disposed: false }
    watchers.set(dir + '/' + exp.id, record)
    const plan = await loadPlan(dir)
    const mine = plan ? plan.experiments.find(e => e.id === exp.id) : undefined
    if (mine) {
      mine.status = 'running'
      mine.startedAt = new Date().toISOString()
      mine.requestedStop = false
      await savePlan(dir, plan)
    }
    const hosts = await loadSshHosts()
    const h = hosts[ws.alias]
    execWatch(h, sudoWrap(ws, 'bash "' + stateDir + '/wrapper.sh"'), sudoStdin(ws), record, (code, out) => onWatcherDone(record, code, out))
    return { ok: true, expId: exp.id }
  }
  async function finalizeExp(rsv, expId, exitCode, status, sessionId, extraNote) {
    const { dir, cfg: ws } = rsv
    const plan = await loadPlan(dir)
    if (!plan) return
    const exp = plan.experiments.find(e => e.id === expId)
    if (!exp) return
    if (exp.requestedStop && status === 'failed') status = 'stopped'
    exp.status = status
    exp.exitCode = exitCode === null || exitCode === undefined ? null : exitCode
    exp.finishedAt = new Date().toISOString()
    await savePlan(dir, plan)
    const pulls = await pullRemoteFiles(ws, dir, ['.remote-lab/experiments/' + expId + '/result.json', '.remote-lab/experiments/' + expId + '/stdout.log'])
    const failed = pulls.filter(r => !r.ok)
    let downloadNote = extraNote || ''
    if (failed.length) downloadNote += (downloadNote ? '；' : '⚠ ') + '自动下载失败 ' + failed.length + ' 项: ' + failed.map(f => f.rel + ' (' + f.err + ')').join('; ')
    await notifyWebhook(ws, { event: 'experiment-' + exp.status, name: ws.name, expId, exitCode: exp.exitCode, goal: plan.goal })
    wakeAgent(sessionId, ws, plan, exp, exp.status, exp.exitCode, downloadNote, dir)
    if (plan.mode === 'auto-chain' && exp.status === 'succeeded') {
      const next = plan.experiments.find(e => e.status === 'pending')
      if (next) await launchExperiment(rsv, next)
    }
    return exp.status
  }
  async function onWatcherDone(record, exitCode, out) {
    if (record.disposed) { log('onWatcherDone skipped (disposed): ' + record.dir + '/' + record.expId); return }
    try {
      const m = /DONE\s+\S+\s+code=(-?\d+)/.exec(out)
      let status, code = exitCode, note = ''
      if (m) {
        code = parseInt(m[1], 10)
        if (code === -99) {
          code = null
          status = 'failed'
          note = '⚠ 无完成记录：watcher 断连期间实验结束（未捕获退出码）'
        } else {
          status = code === 0 ? 'succeeded' : 'failed'
        }
      } else {
        const alive = await remoteExpAlive(record.cfg, record.expId)
        status = alive === true ? 'detached' : 'failed'
        code = null
        if (alive === 'unknown') status = 'detached'
        if (status === 'failed') note = '⚠ 无完成记录：SSH 通道异常关闭'
      }
      watchers.delete(record.dir + '/' + record.expId)
      const curPlan = await loadPlan(record.dir)
      const cur = curPlan ? curPlan.experiments.find(e => e.id === record.expId) : undefined
      if (cur && ['succeeded', 'failed', 'stopped'].includes(cur.status)) {
        log('onWatcherDone: ' + record.expId + ' 已是终态 ' + cur.status + '（可能已由 attach/collect 定稿），跳过重复定稿')
        return
      }
      await finalizeExp(record, record.expId, code, status, record.sessionId, note)
    } catch (e) { log('onWatcherDone error: ' + String(e && (e.stack || e.message) || e)) }
  }

  async function attachTool(rsv, expId) {
    const { dir, cfg: ws } = rsv
    const plan = await loadPlan(dir)
    if (!plan) return 'error: 计划不存在'
    const exp = plan.experiments.find(e => e.id === expId)
    if (!exp) return 'error: 实验不存在: ' + expId
    const stateDir = ws.remoteRoot + '/.remote-lab/experiments/' + exp.id
    const alive = await remoteExpAlive(ws, exp.id)
    log('attachTool(' + exp.id + '): alive=' + alive)
    if (alive === 'unknown') return 'error: 存活探测传输失败（稍后重试）'
    if (!alive) {
      const r = await runWs(ws, 'cat "' + stateDir + '/result.json" 2>/dev/null || echo NO_RESULT')
      let code = null
      let status = 'failed'
      let note = ''
      if (r.stdout && r.stdout.trim() !== 'NO_RESULT') {
        try { code = JSON.parse(r.stdout.trim()).exitCode } catch {}
        status = code === 0 ? 'succeeded' : 'failed'
        if (exp.requestedStop) status = 'stopped'
      } else {
        note = '⚠ 无完成记录：实验已结束但 watcher 未捕获'
        if (exp.requestedStop) status = 'stopped'
      }
      const sid = agents && agents.currentInitiator() ? agents.currentInitiator().id : (plan.createdBySessionId || undefined)
      await finalizeExp(rsv, exp.id, code, status, sid, note)
      return '远端进程已结束 → 已按结果定稿为 ' + status + (code !== null ? ' (exit=' + code + ')' : '')
    }
    const up = await uploadRemoteFile(ws, stateDir + '/attach.sh', buildAttachScript(stateDir, exp.id))
    if (up.exitCode !== 0) return 'error: attach.sh 上传失败: ' + up.err.slice(0, 200)
    const sessionId = agents && agents.currentInitiator() ? agents.currentInitiator().id : (plan.createdBySessionId || undefined)
    const record = { dir, cfg: ws, expId: exp.id, sessionId, kind: 'attach', disposed: false }
    watchers.set(dir + '/' + exp.id, record)
    exp.status = 'running'
    await savePlan(dir, plan)
    const hosts = await loadSshHosts()
    const h = hosts[ws.alias]
    execWatch(h, sudoWrap(ws, 'bash "' + stateDir + '/attach.sh"'), sudoStdin(ws), record, (code, out) => onWatcherDone(record, code, out))
    log('attachTool(' + exp.id + '): attached ok')
    return 'attached: ' + exp.id + '（远端 pid 存活，事件驱动等待完成）'
  }

  async function scanAndAttach(origin) {
    ensureServices()
    try {
      const seen = new Set()
      const dirs = []
      if (existsSync(LAB_ROOT)) {
        try {
          for (const n of await readdir(LAB_ROOT)) {
            const d = legacyDir(n)
            if (await loadBindingConfig(d)) dirs.push(d)
          }
        } catch {}
      }
      try {
        if (workspaceRegistry && typeof workspaceRegistry.list === 'function') {
          for (const w of workspaceRegistry.list()) dirs.push(w.path)
        }
      } catch {}
      for (const d of dirs) {
        const key = resolve(d)
        if (seen.has(key)) continue
        seen.add(key)
        const cfg = await loadBindingConfig(d)
        if (!cfg) continue
        const plan = await loadPlan(d)
        if (!plan) continue
        for (const exp of plan.experiments) {
          if (exp.status === 'running' || exp.status === 'detached') {
            const r = await attachTool({ dir: d, cfg }, exp.id)
            log('scan(' + origin + '): attach ' + d + '/' + exp.id + ' → ' + String(r).slice(0, 200))
          }
        }
      }
    } catch (e) { log('scan(' + origin + ') error: ' + String(e && (e.stack || e.message) || e)) }
  }

  // ---------- 绑定初始化 / API 辅助 ----------
  async function initWorkspace(args) {
    let dir = args.path ? resolve(args.path) : await sessionCwd()
    if (dir && !args.path) dir = workspaceRootOf(dir) || dir // 缺省绑定到会话所属项目根，而非任意子目录
    if (!dir) return { error: '无法确定项目目录（请传入 path，或在项目会话中使用）' }
    const name = basename(dir)
    const nameErr = validateWsName(name)
    if (nameErr) return { error: nameErr }
    const hosts = await loadSshHosts()
    const h = hosts[args.alias]
    if (!h) return { error: 'alias 不在 dsh-ssh.json 中: ' + args.alias + '（现有: ' + Object.keys(hosts).join(', ') + '）' }
    const homeR = await runSsh(h, 'echo "$HOME"')
    const home = homeR.stdout.trim()
    if (!home.startsWith('/')) return { error: '无法解析远端 HOME: ' + home + (homeR.error ? '（' + String(homeR.error).slice(0, 160) + '）' : '') }
    let remoteRoot = args.remoteRoot || ('~/remote-lab/' + name)
    remoteRoot = remoteRoot.replace(/^~\//, home + '/').replace(/\/+$/, '')
    const rootErr = validateRemoteRoot(remoteRoot)
    if (rootErr) return { error: rootErr }
    const mk = await runSsh(h, (args.sudoPassword ? 'sudo -S -p "" bash -lc ' + shQuote('mkdir -p "' + remoteRoot + '" "' + remoteRoot + '/.remote-lab/experiments" && echo MKDIR_OK') : 'mkdir -p "' + remoteRoot + '" "' + remoteRoot + '/.remote-lab/experiments" && echo MKDIR_OK'), args.sudoPassword ? { stdin: args.sudoPassword + '\n' } : {})
    if (!/MKDIR_OK/.test(mk.stdout)) return { error: '远端 mkdir 失败: ' + (mk.error || mk.stderr).slice(-300) }
    const existing = await loadBindingConfig(dir)
    const cfg = {
      version: 1, name, alias: args.alias, remoteRoot,
      repoUrl: args.repoUrl || (existing && existing.repoUrl) || null,
      env: existing && existing.env ? existing.env : {},
      notifyWebhook: args.webhook || (existing && existing.notifyWebhook) || '',
      notifyKind: args.webhookKind || (existing && existing.notifyKind) || 'feishu',
      pullPatterns: existing && existing.pullPatterns ? existing.pullPatterns : [],
      sudoPassword: args.sudoPassword !== undefined ? args.sudoPassword : ((existing && existing.sudoPassword) || ''),
      createdBySessionId: agents && agents.currentInitiator() ? agents.currentInitiator().id : undefined,
    }
    await writeJson(bindingFile(dir), cfg)
    refreshServerCache().catch((e) => log('server cache refresh failed:', e && e.message))
    return { cfg, dir }
  }
  async function unbindProject(dir) {
    try { await unlink(bindingFile(dir)) } catch { return false }
    refreshServerCache().catch((e) => log('server cache refresh failed:', e && e.message))
    return true
  }
  function secretFreeHosts(hosts) {
    return Object.keys(hosts).map(alias => ({ alias, host: hosts[alias].host, port: hosts[alias].port, user: hosts[alias].user }))
  }
  async function projectSummaries() {
    ensureServices()
    const list = []
    const seen = new Set()
    try {
      if (workspaceRegistry && typeof workspaceRegistry.list === 'function') {
        for (const w of workspaceRegistry.list()) {
          const cfg = await loadBindingConfig(w.path)
          const plan = await loadPlan(w.path)
          const counts = {}
          let mode = null
          if (plan) { mode = plan.mode; for (const e of plan.experiments) counts[e.status] = (counts[e.status] || 0) + 1 }
          seen.add(resolve(w.path))
          list.push({ id: String(w.id), title: w.title, path: w.path, binding: cfg ? { alias: cfg.alias, remoteRoot: cfg.remoteRoot, notifyKind: cfg.notifyKind || 'feishu', name: cfg.name, sudoPassword: cfg.sudoPassword || '' } : null, plan: plan ? { mode, counts, goal: plan.goal } : null })
        }
      }
    } catch (e) { log('workspaceRegistry list failed: ' + String(e && e.message || e)) }
    if (existsSync(LAB_ROOT)) {
      try {
        for (const n of await readdir(LAB_ROOT)) {
          const d = legacyDir(n)
          if (seen.has(resolve(d))) continue
          const cfg = await loadBindingConfig(d)
          if (!cfg) continue
          const plan = await loadPlan(d)
          const counts = {}
          let mode = null
          if (plan) { mode = plan.mode; for (const e of plan.experiments) counts[e.status] = (counts[e.status] || 0) + 1 }
          list.push({ id: 'legacy:' + n, title: n + '（旧版）', path: d, binding: { alias: cfg.alias, remoteRoot: cfg.remoteRoot, notifyKind: cfg.notifyKind || 'feishu', name: cfg.name, sudoPassword: cfg.sudoPassword || '' }, plan: plan ? { mode, counts, goal: plan.goal } : null })
        }
      } catch {}
    }
    return list
  }
  function isLoopback(req) {
    const addr = (req.socket && req.socket.remoteAddress) || ''
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  }
  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
  }
  function readJsonBody(req, cap = 65536) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => { size += c.length; if (size > cap) { req.destroy(); resolve(undefined) } else chunks.push(c) })
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { resolve(undefined) } })
      req.on('error', () => resolve(undefined))
    })
  }

  // ---------- 工具定义 ----------
  // 等价 @deepseek-ai/dsh-tools 的 defineTool 规范化：把作者参数 spec
  // （字段级 required）编译为根级 {type:'object', properties, required[]} JSON Schema。
  function defineTool(name, description, parameters, execute) {
    const properties = {}
    const required = []
    for (const key of Object.keys(parameters || {})) {
      const spec = parameters[key] || {}
      const prop = {}
      for (const k of Object.keys(spec)) {
        if (k === 'required') { if (spec.required) required.push(key); continue }
        prop[k] = spec[k]
      }
      if (!prop.type) prop.type = 'string'
      properties[key] = prop
    }
    const schema = { type: 'object', properties }
    if (required.length > 0) schema.required = required
    return {
      name,
      description,
      parameters: schema,
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v ?? '') }] },
      async execute(args) {
        try { return await execute(args || {}) } catch (e) { return 'remote-lab internal error: ' + String(e && (e.stack || e.message) || e) }
      },
    }
  }
  const NO_BINDING = 'error: 当前项目未绑定远程工作区（设置 → 远程实验 页绑定项目，或传入 name 指定 legacy 名称/项目路径）'

  const toolDefs = [
    defineTool('dwa_net_fetch', '网络抓取（网络权限层：直连优先，直连失败自动扫描本地代理如 Clash 回退）：GET/POST 任意 http/https URL，返回状态码与响应文本（上限 256KB）。远程实验需要下载数据、调用外部 API 等网络操作时使用。', {
      url: { type: 'string', required: true },
      method: { type: 'string' },
      body: { type: 'string' },
      headersJson: { type: 'string' },
      timeoutMs: { type: 'number' },
    },
      async (args) => {
        if (!/^https?:\/\//i.test(String(args.url))) return 'error: 仅支持 http/https URL'
        let headers
        if (args.headersJson) {
          try { headers = JSON.parse(args.headersJson) } catch { return 'error: headersJson 解析失败' }
        }
        const timeoutMs = Math.min(args.timeoutMs || 30000, 120000)
        try {
          const res = await net.fetch(String(args.url), {
            method: String(args.method || 'GET').toUpperCase(),
            ...(args.body === undefined ? {} : { body: args.body }),
            ...(headers ? { headers } : {}),
            signal: AbortSignal.timeout(timeoutMs),
          })
          const text = await res.text()
          const clipped = text.length > 262144 ? text.slice(0, 262144) + '\n…（已截断）' : text
          return 'status=' + res.status + '\n' + clipped
        } catch (e) {
          return 'error: ' + (e && e.message || String(e))
        }
      }),

    defineTool('dwa_git', '本地 git 全操作：在 DSH 进程内直接执行 git（不经沙箱受限 token），HTTPS/SSH/LFS 全部可用、零审批——AI 开发时 clone/fetch/pull/push/commit 等一律用本工具，不要走沙箱 shell。command 为 git 命令行（如 "clone --depth 1 https://github.com/x/y.git"、"push origin main"、"status --short"）。子命令白名单 + 危险选项拒绝；LFS 大文件默认跳过（用 dwa_net_download 补）。网络类失败会自动带已发现代理重试一次。可配置策略：push 需审批 / 路径限制（设置页）。全部操作写审计日志。', {
      command: { type: 'string', required: true, description: 'git 命令文本（引号可用；无 shell 展开）' },
      cwd: { type: 'string', description: '工作目录（缺省：当前会话项目根）' },
      timeoutMs: { type: 'number', description: '超时毫秒（默认 600000，最大 3600000）' },
    },
      async (args) => {
        let cwd
        if (args.cwd) cwd = resolve(String(args.cwd))
        else cwd = await gitDefaultCwd()
        if (!cwd) return 'error: 无法确定工作目录（请显式传 cwd）'
        const r = await gitRunner.run({ command: String(args.command), cwd, timeoutMs: args.timeoutMs })
        return formatGitResult(r)
      }),

    defineTool('dwa_net_download', '大文件流式下载（网络权限层：直连优先 → 代理回退 → huggingface.co 自动回退 hf-mirror.com）：下载 GitHub release/codeload/raw 与 HuggingFace 模型文件等到本地（.part 临时文件 → 完成改名），支持大小上限、sha256 校验、Authorization 头（HF token 自动附加）。零审批。默认上限 10GB。', {
      url: { type: 'string', required: true },
      dest: { type: 'string', description: '目标路径（缺省：URL 文件名落到当前会话项目根）' },
      timeoutMs: { type: 'number', description: '超时毫秒（默认 900000，最大 3600000）' },
      maxBytes: { type: 'number', description: '大小上限字节（默认 10GB）' },
      headersJson: { type: 'string', description: '额外请求头 JSON（如 {"Authorization":"Bearer ..."}）' },
      sha256: { type: 'string', description: '可选：期望的 sha256 十六进制（不匹配则删除文件并报错）' },
      mirror: { type: 'boolean', description: 'huggingface.co 失败时回退 hf-mirror.com（默认 true）' },
    },
      async (args) => {
        let headers
        if (args.headersJson) {
          try { headers = JSON.parse(args.headersJson) } catch { return 'error: headersJson 解析失败' }
        }
        const merged = { ...(headers || {}) }
        if (waConfig.hfToken && /^https:\/\/(huggingface\.co|hf\.co|hf-mirror\.com)\//i.test(String(args.url))) {
          if (!merged.Authorization && !merged.authorization) merged.Authorization = 'Bearer ' + waConfig.hfToken
        }
        let dest = args.dest
        if (!dest) {
          const root = await gitDefaultCwd()
          if (!root) return 'error: 无法确定 dest（请显式传 dest）'
          let name = 'download.bin'
          try { name = basename(new URL(String(args.url)).pathname) || 'download.bin' } catch {}
          dest = join(root, name)
        }
        const r = await downloader.download({
          url: String(args.url),
          dest,
          timeoutMs: args.timeoutMs,
          maxBytes: args.maxBytes,
          headers: merged,
          sha256: args.sha256,
          mirror: args.mirror !== false,
        })
        if (!r.ok) return 'error: ' + r.error
        return 'downloaded: ' + r.path + '\nsize=' + r.bytes + ' bytes\nsha256=' + r.sha256 + '\nfinalUrl=' + r.finalUrl
      }),

    defineTool('dwa_arxiv_read', '读取 arXiv 论文全文（优先 HTML 版，秒级返回纯文本）：输入 arXiv 链接（abs/pdf/html）或编号（如 2601.01685、2601.01685v2、旧式 hep-th/9901001），返回标题与正文（公式保留 LaTeX，标签已在服务端剥离）。带版本号 404 时自动降级最新版；无 HTML 版的老论文（2023-12 前收录）返回 PDF 下载建议（用 dwa_net_download）。经网络权限层直连→代理自动回退，零审批。', {
      url: { type: 'string', required: true, description: 'arXiv 链接或编号' },
      maxChars: { type: 'number', description: '正文最大字符数（默认 100000，最大 400000）' },
    },
      async (args) => {
        const r = await arxivReader.read({ url: String(args.url), maxChars: args.maxChars })
        if (!r.ok) return 'error: ' + r.error
        const head = r.title ? '# ' + r.title + '\n\n' : ''
        return head + r.text + (r.truncated ? '\n' + r.note : '') + '\n\n[source: ' + r.url + ']'
      }),

    defineTool('remlab_debug', '返回 remote-lab 插件内部调试日志（最近 100 条）。', {},
      async () => 'watchers=' + JSON.stringify(Array.from(watchers.keys())) + '\n--- recent logs ---\n' + debugLog.slice(-100).join('\n')),

    defineTool('remlab_selfcheck', 'remote-lab 自检：验证本地文件、SSH 配置读取与 ssh2 连通性。', {},
      async () => {
        const lines = []
        lines.push('legacy LAB_ROOT=' + LAB_ROOT)
        lines.push('SSH_CONFIG_PATH=' + SSH_CONFIG_PATH)
        try { const hosts = await loadSshHosts(); lines.push('ssh hosts=' + JSON.stringify(Object.keys(hosts))) } catch (e) { lines.push('ssh config error: ' + String(e && e.message || e)) }
        try {
          const hosts = await loadSshHosts()
          const first = Object.keys(hosts)[0]
          if (first) {
            const r = await runSsh(hosts[first], 'echo REMLAB_ECHO_OK $(hostname)')
            lines.push('ssh echo → exit=' + r.exitCode + ' out=' + r.stdout.trim().slice(0, 120) + (r.error ? ' err=' + r.error.slice(0, 120) : ''))
          }
        } catch (e) { lines.push('ssh probe error: ' + String(e && e.message || e)) }
        return lines.join('\n')
      }),

    defineTool('remlab_ws_init', '把项目绑定到远程工作区（在项目根目录写 .dsh-remote.json，并在远端创建目录）。path 缺省为当前会话所在项目；服务器别名来自 dsh-ssh 配置。换绑 = 重新调用本工具或到设置页改选服务器。远端目录需要 root 权限时提供 sudoPassword（配置后该绑定的所有远端命令经 sudo 执行）。', {
      path: { type: 'string', description: '项目目录绝对路径（缺省：当前会话项目）' },
      alias: { type: 'string', required: true, description: 'dsh-ssh.json 中的主机别名' },
      remoteRoot: { type: 'string', description: '远端根目录（默认 ~/remote-lab/<项目名>）' },
      sudoPassword: { type: 'string', description: 'sudo 密码（可选：目标目录需 root 权限时必填）' },
      repoUrl: { type: 'string', description: '仓库地址（可选，仅记录）' },
      webhook: { type: 'string', description: '飞书/企微机器人 webhook（可选）' },
      webhookKind: { type: 'string', description: 'feishu 或 wecom（默认 feishu）' },
    },
      async (args) => {
        const r = await initWorkspace(args)
        if (r.error) return 'error: ' + r.error
        return '已绑定: 项目 ' + r.dir + ' → ' + r.cfg.alias + ':' + r.cfg.remoteRoot + '（换绑重跑本工具即可）'
      }),

    defineTool('remlab_ws_unbind', '解除项目的远程工作区绑定（删除 .dsh-remote.json；远端目录与本地产物不受影响）。', {
      path: { type: 'string', description: '项目目录绝对路径（缺省：当前会话项目）' },
    },
      async (args) => {
        let dir
        if (args.path) dir = resolve(args.path)
        else {
          const cwd = await sessionCwd()
          dir = cwd ? (workspaceRootOf(cwd) || cwd) : undefined
        }
        if (!dir) return 'error: 无法确定项目目录'
        const ok = await unbindProject(dir)
        return ok ? '已解绑: ' + dir : 'error: 该项目没有绑定文件'
      }),

    defineTool('remlab_ws_status', '查看当前项目绑定的远程工作区状态：远端磁盘/GPU 概览、git 状态、计划状态。', { name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' } },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const { dir, cfg: ws } = rsv
        const lines = []
        lines.push('project=' + dir + ' | ws=' + ws.name + ' alias=' + ws.alias + ' remoteRoot=' + ws.remoteRoot + (ws.sudoPassword ? ' | sudo=on' : ''))
        const r = await runWs(ws, 'cd "' + ws.remoteRoot + '" 2>/dev/null || exit 1; echo "-- git --"; git rev-parse --is-inside-work-tree 2>/dev/null && git status -sb 2>/dev/null | head -5 || echo no-git; echo "-- disk --"; df -h "' + ws.remoteRoot + '" | tail -1; echo "-- gpu --"; nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null | head -6 || echo no-nvidia-smi')
        lines.push(r.stdout)
        if (r.error) lines.push('remote exec error: ' + r.error.slice(-300))
        const plan = await loadPlan(dir)
        if (plan) {
          const counts = {}
          for (const e of plan.experiments) counts[e.status] = (counts[e.status] || 0) + 1
          lines.push('-- plan -- mode=' + plan.mode + ' status=' + JSON.stringify(counts))
        } else {
          lines.push('-- plan -- 无计划')
        }
        return lines.join('\n')
      }),

    defineTool('remlab_exec', '在当前项目绑定的远程工作区内执行一次性命令（cd 到工作区根或 cwd 子目录后执行），返回 stdout/stderr 与退出码。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, command: { type: 'string', required: true }, cwd: { type: 'string' }, timeoutMs: { type: 'number' }, maxBytes: { type: 'number' },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const ws = rsv.cfg
        if (args.cwd && safeRel(args.cwd) === null) return 'error: 非法 cwd（拒绝 .. 与绝对路径，仅限工作区内子目录）'
        const dir = ws.remoteRoot + (args.cwd ? '/' + safeRel(args.cwd) : '')
        const cmd = 'cd "' + dir.replace(/"/g, '\\"') + '" && ' + args.command
        let client
        const hosts = await loadSshHosts()
        const h = hosts[ws.alias]
        try { client = await connect(h) } catch (e) { return 'error: ' + String(e && e.message || e) }
        const killer = args.timeoutMs > 0 ? setTimeout(() => { try { client.destroy() } catch {} }, Math.min(args.timeoutMs, 3600000)) : null
        try {
          const r = ws.sudoPassword ? await execWithStdin(client, 'sudo -S -p "" bash -lc ' + shQuote(cmd), ws.sudoPassword + '\n', { maxBytes: args.maxBytes || 262144 }) : await execOn(client, cmd, { maxBytes: args.maxBytes || 262144 })
          if (killer) clearTimeout(killer)
          return 'exit=' + r.exitCode + '\n--- stdout ---\n' + r.stdout + (r.stderr ? '\n--- stderr ---\n' + r.stderr.slice(-2000) : '') + (r.error ? '\n--- error ---\n' + r.error : '')
        } finally {
          if (killer) clearTimeout(killer)
          try { client.end() } catch {}
          try { client.destroy() } catch {}
        }
      }),

    defineTool('remlab_push', '把当前项目本地文件（相对路径数组，JSON 字符串）上传到绑定工作区对应位置。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, pathsJson: { type: 'string', required: true },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const { dir, cfg: ws } = rsv
        let rels
        try { rels = JSON.parse(args.pathsJson) } catch { return 'error: pathsJson 必须是 JSON 数组' }
        if (!Array.isArray(rels)) return 'error: pathsJson 必须是 JSON 数组'
        const results = []
        for (const rel of rels) {
          const okRel = safeRel(rel)
          if (okRel === null) { results.push({ rel, ok: false, err: '非法路径（拒绝 .. 与绝对路径）' }); continue }
          const localPath = join(dir, okRel)
          const remotePath = ws.remoteRoot + '/' + okRel
          let content
          try { content = await readFile(localPath) } catch (e) { results.push({ rel: okRel, ok: false, err: String(e && e.message || e).slice(-200) }); continue }
          const up = await uploadRemoteFile(ws, remotePath, content, 0o644)
          results.push({ rel: okRel, ok: up.exitCode === 0, err: up.err.slice(-200) })
        }
        return 'push done: ' + results.filter(r => r.ok).length + '/' + results.length + '\n' + results.filter(r => !r.ok).map(r => 'FAIL ' + r.rel + ' ' + r.err).join('\n')
      }),

    defineTool('remlab_pull', '把绑定工作区的远端文件（相对路径数组，JSON 字符串）下载到当前项目对应位置。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, pathsJson: { type: 'string', required: true },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        let rels
        try { rels = JSON.parse(args.pathsJson) } catch { return 'error: pathsJson 必须是 JSON 数组' }
        if (!Array.isArray(rels)) return 'error: pathsJson 必须是 JSON 数组'
        const results = await pullRemoteFiles(rsv.cfg, rsv.dir, rels)
        return 'pull done: ' + results.filter(r => r.ok).length + '/' + results.length + ' → ' + rsv.dir + '\n' + results.filter(r => !r.ok).map(r => 'FAIL ' + r.rel + ' ' + r.err).join('\n')
      }),

    defineTool('remlab_plan_create', '为当前项目创建实验计划：experimentsJson 为数组 [{id,name,command,cwd?,gpus?,env?,timeoutSec?,artifacts?}]，全部置为 pending。mode: manual（默认，完成时唤醒 Agent 决策）或 auto-chain（成功后自动启动下一个）。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, goal: { type: 'string', required: true }, experimentsJson: { type: 'string', required: true }, mode: { type: 'string' },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        let exps
        try { exps = JSON.parse(args.experimentsJson) } catch { return 'error: experimentsJson 解析失败' }
        if (!Array.isArray(exps) || exps.length === 0) return 'error: experimentsJson 必须是非空数组'
        for (const e of exps) {
          if (!e.id || !e.command) return 'error: 每个实验需要 id 与 command'
          if (!/^[a-zA-Z0-9_-]{1,60}$/.test(String(e.id))) return 'error: 非法实验 id: ' + e.id
          e.status = 'pending'
          e.exitCode = null
          if (e.artifacts === undefined) e.artifacts = []
        }
        const plan = {
          version: 1,
          planId: 'plan-' + Date.now().toString(36),
          goal: args.goal,
          mode: args.mode === 'auto-chain' ? 'auto-chain' : 'manual',
          createdBySessionId: agents && agents.currentInitiator() ? agents.currentInitiator().id : undefined,
          createdAt: new Date().toISOString(),
          experiments: exps,
        }
        await savePlan(rsv.dir, plan)
        return 'plan created: ' + plan.planId + ' | ' + exps.length + ' experiments | mode=' + plan.mode
      }),

    defineTool('remlab_plan_status', '查看当前项目的实验计划状态（含远端进程存活探测，仅对 running/detached 实验各执行一次 kill -0 探测）。', { name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' } },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const plan = await loadPlan(rsv.dir)
        if (!plan) return 'error: 该项目还没有实验计划（remlab_plan_create）'
        const lines = []
        lines.push('project=' + rsv.dir + ' plan=' + plan.planId + ' goal=' + plan.goal + ' mode=' + plan.mode)
        for (const e of plan.experiments) {
          let extra = ''
          if (e.status === 'running' || e.status === 'detached') {
            const alive = await remoteExpAlive(rsv.cfg, e.id)
            extra = ' remote-pid ' + (alive === true ? 'alive' : alive === 'unknown' ? 'unknown' : 'dead')
          }
          lines.push('- ' + e.id + ' [' + e.status + ']' + (e.exitCode !== null && e.exitCode !== undefined ? ' exit=' + e.exitCode : '') + extra + ' | ' + (e.name || '') + ' | ' + String(e.command || '').slice(0, 90) + (e.notes ? ' | note: ' + String(e.notes).slice(0, 60) : ''))
        }
        return lines.join('\n')
      }),

    defineTool('remlab_plan_update', '更新当前项目计划：patchJson 形如 {goal?,mode?,experiments:{<id>:{notes?,command?,artifacts?}}}。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, patchJson: { type: 'string', required: true },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const plan = await loadPlan(rsv.dir)
        if (!plan) return 'error: 计划不存在'
        let patch
        try { patch = JSON.parse(args.patchJson) } catch { return 'error: patchJson 解析失败' }
        if (patch.goal !== undefined) plan.goal = patch.goal
        if (patch.mode !== undefined) plan.mode = patch.mode === 'auto-chain' ? 'auto-chain' : 'manual'
        if (patch.experiments && typeof patch.experiments === 'object') {
          for (const id of Object.keys(patch.experiments)) {
            const exp = plan.experiments.find(e => e.id === id)
            if (!exp) continue
            const p = patch.experiments[id]
            if (p.notes !== undefined) exp.notes = p.notes
            if (p.command !== undefined) exp.command = p.command
            if (p.artifacts !== undefined) exp.artifacts = p.artifacts
          }
        }
        await savePlan(rsv.dir, plan)
        return 'plan updated'
      }),

    defineTool('remlab_experiment_launch', '启动当前项目计划中的实验：不指定 expId 时启动第一个 pending（或 failed/stopped 可重跑）实验；立即返回，完成时由回调自动处理。mode 参数可临时把计划切为 auto-chain 或 manual。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, expId: { type: 'string' }, mode: { type: 'string' },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const plan = await loadPlan(rsv.dir)
        if (!plan) return 'error: 计划不存在（先用 remlab_plan_create）'
        if (args.mode === 'auto-chain' || args.mode === 'manual') plan.mode = args.mode
        const exp = args.expId ? plan.experiments.find(e => e.id === args.expId) : plan.experiments.find(e => e.status === 'pending' || e.status === 'failed' || e.status === 'stopped')
        if (!exp) return 'error: 没有可启动的实验（pending/failed/stopped）'
        if (exp.status === 'detached') { await savePlan(rsv.dir, plan); return attachTool(rsv, exp.id) }
        if (!['pending', 'failed', 'stopped'].includes(exp.status)) return 'error: 实验当前状态 ' + exp.status + ' 不可启动'
        exp.requestedStop = false
        await savePlan(rsv.dir, plan)
        const r = await launchExperiment(rsv, exp)
        if (r.ok) return 'launched: ' + exp.id + ' | ' + exp.name + ' | mode=' + plan.mode + ' | 完成时回调自动处理'
        return 'error: ' + r.error
      }),

    defineTool('remlab_experiment_stop', '停止当前项目计划中的实验：向远端进程组发送 SIGTERM（setsid 组杀），watcher 回调会把状态置为 stopped。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, expId: { type: 'string', required: true },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const plan = await loadPlan(rsv.dir)
        if (!plan) return 'error: 计划不存在'
        const exp = plan.experiments.find(e => e.id === args.expId)
        if (!exp) return 'error: 实验不存在: ' + args.expId
        if (exp.status !== 'running' && exp.status !== 'detached') return 'error: 实验当前状态 ' + exp.status + '，无需停止'
        exp.requestedStop = true
        await savePlan(rsv.dir, plan)
        const pidPath = rsv.cfg.remoteRoot + '/.remote-lab/experiments/' + exp.id + '/pid'
        const r = await runWs(rsv.cfg, 'p=$(cat "' + pidPath + '" 2>/dev/null); if [ -n "$p" ]; then kill -- "-$p" 2>/dev/null || kill "$p" 2>/dev/null || kill -9 "$p" 2>/dev/null; echo "STOP_SENT pid=$p"; else echo NO_PID; fi')
        return 'stop requested: ' + r.stdout.trim() + '（watcher 回调将把状态置为 stopped）'
      }),

    defineTool('remlab_experiment_log', '查看当前项目某实验的远端 stdout.log 尾部。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, expId: { type: 'string', required: true }, lines: { type: 'number' },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const logPath = rsv.cfg.remoteRoot + '/.remote-lab/experiments/' + args.expId + '/stdout.log'
        const r = await runWs(rsv.cfg, 'tail -n ' + (args.lines || 40) + ' "' + logPath + '" 2>/dev/null || echo NO_LOG')
        return r.stdout
      }),

    defineTool('remlab_experiment_collect', '下载当前项目某实验的产物到项目本地：result.json + stdout.log + 实验 artifacts + 绑定 pullPatterns。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, expId: { type: 'string', required: true },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        const plan = await loadPlan(rsv.dir)
        if (!plan) return 'error: 计划不存在'
        const exp = plan.experiments.find(e => e.id === args.expId)
        if (!exp) return 'error: 实验不存在: ' + args.expId
        const rels = ['.remote-lab/experiments/' + exp.id + '/result.json', '.remote-lab/experiments/' + exp.id + '/stdout.log']
        for (const a of (exp.artifacts || [])) if (!rels.includes(a)) rels.push(a)
        for (const p of (rsv.cfg.pullPatterns || [])) if (!rels.includes(p)) rels.push(p)
        const results = await pullRemoteFiles(rsv.cfg, rsv.dir, rels)
        return 'collected ' + results.filter(r => r.ok).length + '/' + results.length + ' → ' + expLocalDir(rsv.dir, exp.id) + '\n' + results.filter(r => !r.ok).map(r => 'FAIL ' + r.rel + ' ' + r.err).join('\n')
      }),

    defineTool('remlab_experiment_attach', '重新挂接 watcher 到当前项目正在运行/断线的实验（远端进程存活时事件驱动等待，不轮询）。', {
      name: { type: 'string', description: '可选：legacy 全局工作区名或项目绝对路径' }, expId: { type: 'string', required: true },
    },
      async (args) => {
        const rsv = await resolveWs(args)
        if (!rsv) return NO_BINDING
        return attachTool(rsv, args.expId)
      }),
  ]

  // ---------- 注册与生命周期 ----------
  const disposers = []
  for (const tool of toolDefs) {
    try { disposers.push(ctx.tools.register(tool)) } catch (e) { log('tool register failed for ' + tool.name + ': ' + String(e && e.message || e)) }
  }
  // 设置页 GUI 使用的同源 API（回环防护 + JSON）
  disposers.push(ctx.effect(() => {
    const api = '/api/dsh-remote-lab'
    const routeDisposers = []
    try {
      routeDisposers.push(ctx.webServer.register({ kind: 'exact', path: api + '/hosts', handler: async (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        const hosts = await loadSshHosts()
        sendJson(res, 200, { hosts: secretFreeHosts(hosts) })
      } }))
      routeDisposers.push(ctx.webServer.register({ kind: 'exact', path: api + '/session-binding', handler: async (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        const url = new URL(req.url || '', 'http://localhost')
        const sessionId = url.searchParams.get('sessionId')
        if (!sessionId) return sendJson(res, 400, { error: 'missing sessionId' })
        const cwd = await sessionCwdById(sessionId)
        if (!cwd) return sendJson(res, 404, { error: 'session workspace not found' })
        const root = workspaceRootOf(cwd)
        const b = await findBindingWithin(cwd, root || cwd)
        const cfg = b ? b.cfg : undefined
        const hosts = await loadSshHosts()
        sendJson(res, 200, {
          path: root || cwd,
          title: basename(root || cwd),
          binding: cfg ? { alias: cfg.alias, remoteRoot: cfg.remoteRoot, notifyWebhook: cfg.notifyWebhook || '', notifyKind: cfg.notifyKind || 'feishu', sudoPassword: cfg.sudoPassword || '' } : null,
          hosts: secretFreeHosts(hosts),
        })
      } }))
      routeDisposers.push(ctx.webServer.register({ kind: 'exact', path: api + '/workspaces', handler: async (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        sendJson(res, 200, { projects: await projectSummaries() })
      } }))
      routeDisposers.push(ctx.webServer.register({ kind: 'exact', path: api + '/bindings', handler: async (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          if (!body) return sendJson(res, 400, { error: 'invalid JSON body' })
          if (!body.path && body.sessionId) {
            const cwd = await sessionCwdById(body.sessionId)
            if (!cwd) return sendJson(res, 400, { error: '无法确定该会话的项目目录' })
            body.path = cwd
          }
          if (!body.path) return sendJson(res, 400, { error: 'invalid JSON body (need path or sessionId)' })
          const r = await initWorkspace(body)
          if (r.error) return sendJson(res, 400, { error: r.error })
          return sendJson(res, 200, { ok: true, binding: { path: r.dir, alias: r.cfg.alias, remoteRoot: r.cfg.remoteRoot } })
        }
        if (req.method === 'DELETE') {
          const body = await readJsonBody(req)
          if (!body || !body.path) return sendJson(res, 400, { error: 'invalid JSON body (need path)' })
          const ok = await unbindProject(resolve(body.path))
          return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'binding not found' })
        }
        sendJson(res, 405, { error: 'method not allowed' })
      } }))
      routeDisposers.push(ctx.webServer.register({ kind: 'exact', path: api + '/git-config', handler: async (req, res) => {
        if (!isLoopback(req)) return sendJson(res, 403, { error: 'forbidden: loopback-only' })
        if (req.method === 'GET') {
          return sendJson(res, 200, {
            git: waConfig.git,
            hfTokenSet: typeof waConfig.hfToken === 'string' && waConfig.hfToken.length > 0,
            auditPath: GIT_AUDIT_PATH,
            proxy: net.discoveredProxy(),
          })
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          if (!body) return sendJson(res, 400, { error: 'invalid JSON body' })
          if (body.git && typeof body.git === 'object') {
            waConfig.git.pushApproval = body.git.pushApproval === true
            waConfig.git.restrictPaths = body.git.restrictPaths === true
          }
          if (typeof body.hfToken === 'string' && body.hfToken !== '') {
            waConfig.hfToken = body.hfToken.trim()
          }
          await saveWaConfig()
          return sendJson(res, 200, { ok: true })
        }
        sendJson(res, 405, { error: 'method not allowed' })
      } }))
    } catch (e) { log('routes register failed: ' + String(e && e.message || e)) }
    return () => { for (const d of routeDisposers) { try { d() } catch {} } }
  }))
  disposers.push(ctx.systemPrompt.section({
    name: 'plugin:remote-lab',
    order: 150,
    text: '本机已安装 dsh-remote-lab 插件（项目 ↔ 远程工作区绑定 + 回调驱动实验计划）。每个项目用根目录下的 .dsh-remote.json 绑定一个远程工作区（服务器别名/远端根目录/webhook/sudoPassword），换服务器 = 重新绑定即可；服务器在侧边栏 SSH 面板配置。绑定可携带 sudo 密码：配置后该绑定下所有远端命令（mkdir/执行/上传/下载/停止）经 sudo -S 以 root 执行，目标目录需要 root 权限时务必配置。设置面板「远程实验」页与对话标题栏「远程实验」按钮可图形化绑定/换绑/解绑。工具默认作用于「当前会话所在项目」的绑定（严格按项目：先定位会话所属已注册工作区根，绑定只在项目根读取，子目录自动归属项目根；未绑定项目绝不继承祖先绑定），也可显式传 name（legacy 全局工作区名或项目绝对路径，显式路径仅指该目录本身）：remlab_ws_init/ws_unbind/ws_status 管理绑定与状态；remlab_exec/push/pull 远程执行与文件同步；remlab_plan_create/plan_status/plan_update 管理实验计划（manual：完成时唤醒 Agent 决策；auto-chain：成功后自动启动下一实验）；remlab_experiment_launch/stop/log/collect/attach 运行实验——launch 立即返回，实验完成由回调自动处理（状态落盘、产物下载到项目 .remote-lab/、通知、唤醒 Agent），无需轮询。断线后远端实验继续运行，重启/attach 可恢复。remlab_debug 可查看插件内部日志。网络权限：直连优先；直连失败时自动扫描本机可用代理（环境变量 → Windows 系统代理 → 常见 Clash 端口 7890/7897 等）回退，命中代理缓存 10 分钟。需要抓取外部资源/调用外部 API 时用 dwa_net_fetch 工具。本地 git 与下载（零审批，不经沙箱）：沙箱内的 shell 跑 git/curl 会因受限 token（命名管道 + schannel 无凭据）失败——本地 git 全部操作请用 dwa_git 工具（DSH 进程内直接执行 git，HTTPS/SSH/LFS 可用，网络失败自动带代理重试，白名单 + 审计，设置页可开 push 审批/路径限制）；下载 GitHub release/codeload/raw 与 HuggingFace 模型等大文件用 dwa_net_download（流式落盘、直连→代理→hf-mirror 回退、sha256 校验、HF token 自动附加，默认上限 10GB）。阅读 arXiv 论文用 dwa_arxiv_read 工具（传入链接或编号即可拿到 HTML 版全文纯文本，公式保留 LaTeX，比下 PDF 快得多；无 HTML 的老论文会返回 PDF 下载建议）。',
  }))
  // 每会话一次性注入「远程服务器速查」（仅 startup/resume 时注入一次；只含该会话项目绑定的那一台服务器）
  try { disposers.push(ctx.on('agent/session-start', ({ agent, source }) => {
    if (source === 'startup' || source === 'resume') injectServerContext(agent)
  })) } catch (e) { log('agent/session-start listener failed:', e && e.message) }
  refreshServerCache().catch((e) => log('server cache refresh failed:', e && e.message))
  loadWaConfig().catch((e) => log('wa config load failed:', e && e.message))

  ctx.effect(() => () => {
    for (const key of Array.from(watchers.keys())) {
      const rec = watchers.get(key)
      if (rec) rec.disposed = true
    }
    watchers.clear()
    for (const d of disposers) { try { d() } catch {} }
  })

  log('plugin applied, legacy LAB_ROOT=' + LAB_ROOT)
  const scanTimer = setTimeout(() => { scanAndAttach('deferred').catch(e => log('deferred scan failed: ' + String(e && e.message || e))) }, 3000)
  ctx.effect(() => () => clearTimeout(scanTimer))
}
