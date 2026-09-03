/**
 * dsh-work-anywhere · 本地 git 执行器
 *
 * 核心语义：在 DSH 进程内直接 spawn git.exe——不经 ctx.sandbox.confine（受限 token 包装），
 * 因此不受「命名管道禁用 + schannel 无凭据」两条沙箱边界影响，git 全部操作（HTTPS/SSH/LFS）
 * 以普通用户 token 运行，零审批。
 *
 * 安全策略（默认全放开，可按配置收紧）：
 * - 无 shell：argv 直传 git.exe，命令解析器拒绝明确 shell 元字符；
 * - 子命令白名单 + 拒绝 --upload-pack/--receive-pack/-c core.sshCommand/-c core.gitProxy；
 * - restrictPaths：仅允许已注册项目根内的 cwd；
 * - pushApproval：push 需经注入的审批函数放行（可接 ctx.approval → 微信转发）；
 * - 全量审计记录。
 *
 * 网络回退：网络类失败且存在已发现代理时，自动注入 -c http.proxy=<代理> 重试一次。
 */
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from 'node:child_process'
import { resolve, sep } from 'node:path'

/** git 子命令白名单（常见开发/协作操作全集；不含 exec 类逃逸子命令）。 */
export const GIT_SUBCOMMANDS = [
  'clone', 'init', 'add', 'mv', 'rm', 'restore', 'reset', 'status', 'diff', 'log', 'show',
  'branch', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick', 'commit', 'tag',
  'fetch', 'pull', 'push', 'remote', 'stash', 'worktree', 'submodule', 'config',
  'ls-remote', 'rev-parse', 'describe', 'archive', 'clean', 'grep', 'blame', 'shortlog',
  'format-patch', 'am', 'apply', 'bisect', 'revert', 'gc', 'fsck', 'for-each-ref',
  'update-ref', 'symbolic-ref', 'reflog', 'lfs', 'count-objects', 'bundle', 'verify-commit',
]

const SHELL_META_UNQUOTED = /[;&|<>`\r\n\u0000]/

/**
 * 把一行 git 命令文本解析为 argv（不做任何 shell 展开）。
 * 支持双引号（\" 转义）与单引号；引号外的 ; | & < > ` 换行 NUL 直接拒绝。
 * @returns {{ok:true, argv:string[]}|{ok:false, error:string}}
 */
export function tokenizeGitCommand(text) {
  const s = String(text ?? '')
  if (!s.trim()) return { ok: false, error: '命令为空' }
  const argv = []
  let cur = ''
  let has = false
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t') {
      if (has) { argv.push(cur); cur = ''; has = false }
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      i++
      let closed = false
      while (i < s.length) {
        const d = s[i]
        if (d === q) { closed = true; i++; break }
        if (d === '\\' && q === '"' && s[i + 1] === '"') { cur += '"'; i += 2; continue }
        if (d === '\r' || d === '\n' || d === '\u0000') return { ok: false, error: '命令包含换行/控制字符' }
        cur += d
        i++
      }
      if (!closed) return { ok: false, error: '引号未闭合' }
      has = true
      continue
    }
    if (SHELL_META_UNQUOTED.test(c)) return { ok: false, error: '命令包含 shell 元字符 ' + JSON.stringify(c) + '（引号内才允许）' }
    cur += c
    has = true
    i++
  }
  if (has) argv.push(cur)
  if (argv.length === 0) return { ok: false, error: '命令为空' }
  return { ok: true, argv }
}

/** 子命令白名单 + 危险选项校验。@returns {{ok:true, subcommand:string, argv:string[]}|{ok:false, error:string}} */
export function parseGitInvocation(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return { ok: false, error: '命令为空' }
  // 跳过前导全局选项（如 -c key=value、--no-pager）定位子命令；-C 拒绝（cwd 须走工具参数）
  let i = 0
  while (i < argv.length && String(argv[i]).startsWith('-')) {
    if (argv[i] === '-C') return { ok: false, error: '拒绝 -C（请使用 cwd 参数）' }
    if (argv[i] === '-c') i += 2
    else i += 1
  }
  if (i >= argv.length) return { ok: false, error: '命令缺少 git 子命令' }
  const subcommand = String(argv[i])
  if (!GIT_SUBCOMMANDS.includes(subcommand)) return { ok: false, error: '不支持的 git 子命令: ' + subcommand }
  let afterDashDash = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { afterDashDash = true; continue }
    if (!afterDashDash) {
      if (a === '--upload-pack' || a === '--receive-pack') return { ok: false, error: '拒绝危险选项: ' + a }
      if (a === '-c' && typeof argv[i + 1] === 'string') {
        const key = argv[i + 1].split('=')[0].toLowerCase()
        if (key === 'core.sshcommand' || key === 'core.gitproxy') return { ok: false, error: '拒绝危险配置: -c ' + argv[i + 1] }
      }
    }
  }
  return { ok: true, subcommand, argv }
}

const NETWORK_FAILURE = /could not resolve host|unable to access|failed to connect|connection (timed out|refused|reset|closed)|operation timed out|timed out|schannel|sec_e_|ssl (connect|certificate)|network is unreachable|proxy connect|tls handshake|name or service not known|getaddrinfo/i

/** 判断 git 输出是否网络类失败（用于决定是否带代理重试）。 */
export function isNetworkFailure(text) {
  return NETWORK_FAILURE.test(String(text ?? ''))
}

/** 把发现的代理地址转成 git -c http.proxy 配置对；socks5 改写为 socks5h（git 语法）。 */
export function proxyConfigArgs(proxy) {
  let p = String(proxy ?? '')
  if (/^socks5:\/\//i.test(p)) p = 'socks5h://' + p.slice('socks5://'.length)
  return ['-c', 'http.proxy=' + p]
}

/** git 子进程环境：跳过 LFS 拉取（大文件走 dwa_net_download）、禁用终端交互提示。 */
export function defaultGitEnv(env = process.env) {
  return { ...env, GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
}

/** 把 runner 结果渲染为工具输出文本（含拒绝/错误/代理重试/超时标注）。 */
export function formatGitResult(r) {
  if (!r || typeof r !== 'object') return 'error: empty result'
  if (r.rejected) return '⚠ push 未获批准（设置页 git 策略 pushApproval 已开启）'
  if (!r.ok && r.error && (r.exitCode === null || r.exitCode === undefined)) return 'error: ' + r.error
  const lines = []
  lines.push('exit=' + r.exitCode + (r.timedOut ? '（超时）' : ''))
  if (r.usedProxy) lines.push('ℹ 直连网络失败，已自动经代理重试: ' + r.proxy)
  if (r.stdout) lines.push('--- stdout ---\n' + r.stdout)
  if (r.stderr) lines.push('--- stderr ---\n' + r.stderr)
  return lines.join('\n')
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

const MAX_STDOUT = 512 * 1024
const MAX_STDERR = 256 * 1024

function capAppend(buf, chunk, max) {
  buf += chunk.toString('utf8')
  if (buf.length > max) buf = buf.slice(-max)
  return buf
}

/**
 * 本地 git 执行器工厂（全部依赖可注入）。
 * @param spawnImpl(argv, opts) 返回 child（node child_process 形状；argv[0] 为程序）
 * @param spawnSyncImpl 进程树清理用
 * @param discoverProxy() 已发现/缓存的代理地址（无则 null）
 * @param policy() 当前安全策略 {restrictPaths, allowedRoots, pushApproval}
 * @param requestPushApproval({subcommand, args, cwd}) push 审批（pushApproval 开启时调用）
 * @param audit(record) 审计回调
 * @param sessionRoot() 会话工作区根（缺省 cwd）
 * @param defaultTimeoutMs 缺省超时
 */
export function createGitRunner({
  spawnImpl = (argv, opts) => nodeSpawn(argv[0], argv.slice(1), opts),
  spawnSyncImpl = nodeSpawnSync,
  discoverProxy = () => null,
  policy = () => ({ restrictPaths: false, allowedRoots: [], pushApproval: false }),
  requestPushApproval = async () => true,
  audit = null,
  sessionRoot = () => process.cwd(),
  defaultTimeoutMs = 600000,
  log = null,
} = {}) {
  async function spawnOnce(argv, cwd, timeoutMs) {
    const env = defaultGitEnv()
    const signal = AbortSignal.timeout(timeoutMs)
    return await new Promise((resolveResult) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (rec) => { if (!settled) { settled = true; resolveResult(rec) } }
      let child
      try {
        child = spawnImpl(argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], signal, windowsHide: true })
      } catch (e) {
        return finish({ ok: false, exitCode: null, stdout: '', stderr: '', error: String(e && e.message || e), timedOut: false })
      }
      const pid = child.pid
      child.stdout?.on('data', (d) => { stdout = capAppend(stdout, d, MAX_STDOUT) })
      child.stderr?.on('data', (d) => { stderr = capAppend(stderr, d, MAX_STDERR) })
      const killTree = () => {
        try { child.kill() } catch {}
        if (isWin && pid) {
          try { spawnSyncImpl('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore', timeout: 10000 }) } catch {}
        }
      }
      signal.addEventListener('abort', killTree, { once: true })
      child.on('error', (e) => {
        finish({ ok: false, exitCode: null, stdout, stderr, error: String(e && e.message || e), timedOut: signal.aborted })
      })
      child.on('close', (code, sig) => {
        finish({ ok: code === 0, exitCode: code, stdout, stderr, error: '', timedOut: signal.aborted, signal: sig })
      })
    })
  }

  return {
    async run({ command, cwd, timeoutMs } = {}) {
      const tok = tokenizeGitCommand(command)
      if (!tok.ok) return { ok: false, error: tok.error }
      const parsed = parseGitInvocation(tok.argv)
      if (!parsed.ok) return { ok: false, error: parsed.error }

      const cfg = policy()
      const targetCwd = cwd ? resolve(String(cwd)) : sessionRoot()
      if (cfg.restrictPaths) {
        const roots = Array.isArray(cfg.allowedRoots) && cfg.allowedRoots.length > 0 ? cfg.allowedRoots : [sessionRoot()]
        if (!roots.some((r) => pathWithin(r, targetCwd))) {
          const rec = { ts: new Date().toISOString(), subcommand: parsed.subcommand, args: tok.argv, cwd: targetCwd, outcome: 'denied-path' }
          try { audit?.(rec) } catch {}
          return { ok: false, error: 'cwd 不允许（restrictPaths 策略）：' + targetCwd }
        }
      }

      if (cfg.pushApproval && parsed.subcommand === 'push') {
        let approved = false
        try { approved = await requestPushApproval({ subcommand: parsed.subcommand, args: tok.argv, cwd: targetCwd }) } catch { approved = false }
        if (!approved) {
          const rec = { ts: new Date().toISOString(), subcommand: parsed.subcommand, args: tok.argv, cwd: targetCwd, outcome: 'denied-push' }
          try { audit?.(rec) } catch {}
          return { ok: false, rejected: true, error: 'push 未获批准' }
        }
      }

      const effTimeout = Math.min(Math.max(1, timeoutMs || defaultTimeoutMs), 3600000)
      let result = await spawnOnce(['git', ...tok.argv], targetCwd, effTimeout)

      // 网络失败 + 已发现代理 → 带代理重试一次
      if (!result.ok && !result.timedOut && !result.error && isNetworkFailure(result.stderr + result.stdout)) {
        let proxy = null
        try { proxy = discoverProxy() } catch {}
        if (proxy) {
          const retry = await spawnOnce(['git', ...proxyConfigArgs(proxy), ...tok.argv], targetCwd, effTimeout)
          retry.usedProxy = true
          retry.proxy = proxy
          result = retry
        }
      }

      try {
        audit?.({
          ts: new Date().toISOString(),
          subcommand: parsed.subcommand,
          args: tok.argv,
          cwd: targetCwd,
          outcome: result.ok ? 'ok' : (result.rejected ? 'denied-push' : (result.timedOut ? 'timeout' : 'exit-' + result.exitCode)),
          exitCode: result.exitCode,
          usedProxy: result.usedProxy === true,
        })
      } catch {}
      if (log) log('git ' + parsed.subcommand + ' exit=' + result.exitCode + (result.usedProxy ? ' proxy-retry' : ''))
      return result
    },
  }
}
