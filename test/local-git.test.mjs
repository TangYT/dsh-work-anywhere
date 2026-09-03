/**
 * lib/local-git.js 的 TDD 测试：本地 git 执行器（DSH 进程内直接 spawn git，绕过沙箱 confine）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tokenizeGitCommand,
  parseGitInvocation,
  isNetworkFailure,
  proxyConfigArgs,
  defaultGitEnv,
  createGitRunner,
  formatGitResult,
} from '../lib/local-git.js'

// ---------- tokenizeGitCommand ----------

test('tokenizeGitCommand: 按空白切分普通参数', () => {
  assert.deepEqual(tokenizeGitCommand('clone --depth 1 https://x/y.git').argv, ['clone', '--depth', '1', 'https://x/y.git'])
})

test('tokenizeGitCommand: 双引号把带空格参数合并为一个 token', () => {
  assert.deepEqual(tokenizeGitCommand('commit -m "hello world"').argv, ['commit', '-m', 'hello world'])
})

test('tokenizeGitCommand: 单引号同样合并，且内部双引号为字面量', () => {
  assert.deepEqual(tokenizeGitCommand("commit -m 'say \"hi\"'").argv, ['commit', '-m', 'say "hi"'])
})

test('tokenizeGitCommand: 双引号内反斜杠转义双引号', () => {
  assert.deepEqual(tokenizeGitCommand('commit -m "a\\"b"').argv, ['commit', '-m', 'a"b'])
})

test('tokenizeGitCommand: 空输入报错', () => {
  const r = tokenizeGitCommand('   ')
  assert.equal(r.ok, false)
  assert.match(r.error, /空/)
})

test('tokenizeGitCommand: 拒绝未加引号的分号', () => {
  assert.equal(tokenizeGitCommand('status; rm -rf x').ok, false)
})

test('tokenizeGitCommand: 拒绝未加引号的管道符', () => {
  assert.equal(tokenizeGitCommand('log | head').ok, false)
})

test('tokenizeGitCommand: 拒绝反引号', () => {
  assert.equal(tokenizeGitCommand('log `id`').ok, false)
})

test('tokenizeGitCommand: 拒绝换行', () => {
  assert.equal(tokenizeGitCommand('log\npwd').ok, false)
})

test('tokenizeGitCommand: 拒绝未闭合引号', () => {
  assert.equal(tokenizeGitCommand('commit -m "oops').ok, false)
})

test('tokenizeGitCommand: 引号内的 shell 元字符按字面量保留', () => {
  assert.deepEqual(tokenizeGitCommand('commit -m "a;b|c&d"').argv, ['commit', '-m', 'a;b|c&d'])
})

test('tokenizeGitCommand: 未引号的 $() 也是字面量（无 shell 解释，仅拒绝明确元字符）', () => {
  assert.deepEqual(tokenizeGitCommand('commit -m $(date)').argv, ['commit', '-m', '$(date)'])
})

// ---------- parseGitInvocation ----------

test('parseGitInvocation: 白名单子命令通过', () => {
  assert.deepEqual(parseGitInvocation(['clone', '--depth', '1', 'u']), { ok: true, subcommand: 'clone', argv: ['clone', '--depth', '1', 'u'] })
})

test('parseGitInvocation: 未知子命令被拒绝', () => {
  const r = parseGitInvocation(['exec', 'evil'])
  assert.equal(r.ok, false)
  assert.match(r.error, /exec/)
})

test('parseGitInvocation: 空 argv 报错', () => {
  assert.equal(parseGitInvocation([]).ok, false)
})

test('parseGitInvocation: 拒绝 --upload-pack', () => {
  assert.equal(parseGitInvocation(['clone', '--upload-pack', 'x', 'u']).ok, false)
})

test('parseGitInvocation: 拒绝 --receive-pack', () => {
  assert.equal(parseGitInvocation(['push', '--receive-pack', 'x', 'origin']).ok, false)
})

test('parseGitInvocation: -- 之后的 --receive-pack 是字面量引用，允许', () => {
  assert.equal(parseGitInvocation(['push', 'origin', '--', '--receive-pack']).ok, true)
})

test('parseGitInvocation: 拒绝 -c core.sshCommand', () => {
  assert.equal(parseGitInvocation(['-c', 'core.sshCommand=evil', 'push']).ok, false)
})

test('parseGitInvocation: 拒绝 -c core.gitProxy', () => {
  assert.equal(parseGitInvocation(['-c', 'core.gitProxy=evil', 'clone', 'u']).ok, false)
})

test('parseGitInvocation: 普通 -c（如 http.proxy）允许', () => {
  assert.equal(parseGitInvocation(['-c', 'http.proxy=http://127.0.0.1:7897', 'clone', 'u']).ok, true)
})

// ---------- isNetworkFailure ----------

test('isNetworkFailure: schannel 凭据错误识别为网络失败', () => {
  assert.equal(isNetworkFailure('fatal: unable to access https://github.com/: schannel: SEC_E_NO_CREDENTIALS'), true)
})

test('isNetworkFailure: 连接超时识别为网络失败', () => {
  assert.equal(isNetworkFailure('ssh: connect to host github.com port 22: Connection timed out'), true)
})

test('isNetworkFailure: 域名解析失败识别为网络失败', () => {
  assert.equal(isNetworkFailure('fatal: unable to access: Could not resolve host: x'), true)
})

test('isNetworkFailure: 目标目录已存在不是网络失败', () => {
  assert.equal(isNetworkFailure("fatal: destination path 'x' already exists and is not an empty directory."), false)
})

test('isNetworkFailure: 认证失败不是网络失败', () => {
  assert.equal(isNetworkFailure('fatal: Authentication failed'), false)
})

// ---------- proxyConfigArgs ----------

test('proxyConfigArgs: http 代理原样返回 http.proxy 配置对', () => {
  assert.deepEqual(proxyConfigArgs('http://127.0.0.1:7897'), ['-c', 'http.proxy=http://127.0.0.1:7897'])
})

test('proxyConfigArgs: socks5 改写为 socks5h', () => {
  assert.deepEqual(proxyConfigArgs('socks5://127.0.0.1:1080'), ['-c', 'http.proxy=socks5h://127.0.0.1:1080'])
})

// ---------- defaultGitEnv ----------

test('defaultGitEnv: 注入 LFS 跳过与禁用交互提示，并保留既有环境变量', () => {
  const env = defaultGitEnv({ HOME: 'C:\\Users\\x' })
  assert.equal(env.GIT_LFS_SKIP_SMUDGE, '1')
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(env.HOME, 'C:\\Users\\x')
})

// ---------- createGitRunner ----------

/** 测试用假子进程：记录 spawn 调用，按脚本产出输出/退出。 */
function fakeSpawn(script) {
  const calls = []
  const spawnImpl = (argv, opts) => {
    const rec = { argv, opts, killCount: 0 }
    calls.push(rec)
    const step = script(calls.length - 1, argv, opts)
    const child = {
      pid: 1000 + calls.length,
      stdout: { on: (ev, cb) => { if (ev === 'data' && step.stdout) queueMicrotask(() => cb(Buffer.from(step.stdout))) } },
      stderr: { on: (ev, cb) => { if (ev === 'data' && step.stderr) queueMicrotask(() => cb(Buffer.from(step.stderr))) } },
      on: (ev, cb) => {
        if (ev === 'close') {
          if (step.delayMs) setTimeout(() => { if (opts.signal?.aborted) child.kill('SIGTERM'); cb(step.code, step.signal ?? null) }, step.delayMs)
          else queueMicrotask(() => { if (opts.signal?.aborted) child.kill('SIGTERM'); cb(step.code, step.signal ?? null) })
        }
        if (ev === 'error') { if (step.spawnError) queueMicrotask(() => cb(new Error(step.spawnError))) }
      },
      kill: () => { rec.killCount++ },
    }
    return child
  }
  return { spawnImpl, calls }
}

test('runner: 成功执行返回 exit=0 与 stdout，argv 以 git 开头', async () => {
  const { spawnImpl, calls } = fakeSpawn(() => ({ code: 0, stdout: 'ok output' }))
  const runner = createGitRunner({ spawnImpl, sessionRoot: () => 'E:\\ws' })
  const r = await runner.run({ command: 'status --short' })
  assert.equal(r.ok, true)
  assert.equal(r.exitCode, 0)
  assert.match(r.stdout, /ok output/)
  assert.deepEqual(calls[0].argv, ['git', 'status', '--short'])
  assert.equal(calls[0].opts.cwd, 'E:\\ws')
})

test('runner: 退出码非零时 ok=false 并带回 stderr', async () => {
  const { spawnImpl } = fakeSpawn(() => ({ code: 128, stderr: 'fatal: Authentication failed' }))
  const runner = createGitRunner({ spawnImpl, sessionRoot: () => 'E:\\ws' })
  const r = await runner.run({ command: 'push origin main' })
  assert.equal(r.ok, false)
  assert.equal(r.exitCode, 128)
  assert.match(r.stderr, /Authentication failed/)
})

test('runner: restrictPaths 开启时拒绝根目录外的 cwd，且不 spawn', async () => {
  const { spawnImpl, calls } = fakeSpawn(() => ({ code: 0 }))
  const runner = createGitRunner({
    spawnImpl,
    sessionRoot: () => 'E:\\ws',
    policy: () => ({ restrictPaths: true, allowedRoots: ['E:\\ws'], pushApproval: false }),
  })
  const r = await runner.run({ command: 'status', cwd: 'C:\\evil' })
  assert.equal(r.ok, false)
  assert.match(r.error, /不允许/)
  assert.equal(calls.length, 0)
})

test('runner: restrictPaths 开启时允许根目录内的 cwd', async () => {
  const { spawnImpl, calls } = fakeSpawn(() => ({ code: 0 }))
  const runner = createGitRunner({
    spawnImpl,
    sessionRoot: () => 'E:\\ws',
    policy: () => ({ restrictPaths: true, allowedRoots: ['E:\\ws'], pushApproval: false }),
  })
  const r = await runner.run({ command: 'status', cwd: 'E:\\ws\\sub' })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
})

test('runner: pushApproval 拒绝时返回 rejected 且不 spawn', async () => {
  const { spawnImpl, calls } = fakeSpawn(() => ({ code: 0 }))
  const runner = createGitRunner({
    spawnImpl,
    sessionRoot: () => 'E:\\ws',
    policy: () => ({ restrictPaths: false, pushApproval: true }),
    requestPushApproval: async () => false,
  })
  const r = await runner.run({ command: 'push origin main' })
  assert.equal(r.ok, false)
  assert.equal(r.rejected, true)
  assert.equal(calls.length, 0)
})

test('runner: pushApproval 批准后正常执行', async () => {
  const { spawnImpl, calls } = fakeSpawn(() => ({ code: 0, stdout: 'pushed' }))
  const runner = createGitRunner({
    spawnImpl,
    sessionRoot: () => 'E:\\ws',
    policy: () => ({ restrictPaths: false, pushApproval: true }),
    requestPushApproval: async () => true,
  })
  const r = await runner.run({ command: 'push origin main' })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 1)
})

test('runner: 网络失败且存在已发现代理时，自动带代理重试一次', async () => {
  const { spawnImpl, calls } = fakeSpawn((i) => (i === 0
    ? { code: 128, stderr: 'fatal: unable to access https://github.com/: schannel: SEC_E_NO_CREDENTIALS' }
    : { code: 0, stdout: 'retried ok' }))
  const runner = createGitRunner({
    spawnImpl,
    sessionRoot: () => 'E:\\ws',
    discoverProxy: () => 'http://127.0.0.1:7897',
  })
  const r = await runner.run({ command: 'clone https://github.com/a/b.git' })
  assert.equal(r.ok, true)
  assert.equal(r.usedProxy, true)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].argv, ['git', '-c', 'http.proxy=http://127.0.0.1:7897', 'clone', 'https://github.com/a/b.git'])
})

test('runner: 非网络失败不重试，也不查询代理', async () => {
  let proxyQueried = 0
  const { spawnImpl, calls } = fakeSpawn(() => ({ code: 128, stderr: 'fatal: Authentication failed' }))
  const runner = createGitRunner({
    spawnImpl,
    sessionRoot: () => 'E:\\ws',
    discoverProxy: () => { proxyQueried++; return 'http://127.0.0.1:7897' },
  })
  const r = await runner.run({ command: 'push origin main' })
  assert.equal(r.ok, false)
  assert.equal(calls.length, 1)
  assert.equal(proxyQueried, 0)
})

test('runner: 超时后标记 timedOut 并杀进程', async () => {
  const { spawnImpl, calls } = fakeSpawn(() => ({ code: null, signal: 'SIGTERM', delayMs: 40 }))
  const runner = createGitRunner({ spawnImpl, sessionRoot: () => 'E:\\ws' })
  const r = await runner.run({ command: 'status', timeoutMs: 10 })
  assert.equal(r.timedOut, true)
  assert.ok(calls[0].killCount > 0)
})

test('runner: spawn 级错误（如 git 不存在）转为 error 结果', async () => {
  const { spawnImpl } = fakeSpawn(() => ({ code: 0, spawnError: 'ENOENT' }))
  const runner = createGitRunner({ spawnImpl, sessionRoot: () => 'E:\\ws' })
  const r = await runner.run({ command: 'status' })
  assert.equal(r.ok, false)
  assert.match(r.error, /ENOENT/)
})

test('runner: 每次执行都写审计记录（含子命令与 cwd）', async () => {
  const { spawnImpl } = fakeSpawn(() => ({ code: 0 }))
  const audits = []
  const runner = createGitRunner({
    spawnImpl,
    sessionRoot: () => 'E:\\ws',
    audit: (rec) => audits.push(rec),
  })
  await runner.run({ command: 'clone https://github.com/a/b.git', cwd: 'E:\\ws' })
  assert.equal(audits.length, 1)
  assert.equal(audits[0].subcommand, 'clone')
  assert.equal(audits[0].cwd, 'E:\\ws')
})

test('runner: LFS 跳过与禁用提示的环境变量随 spawn 传递', async () => {
  const { spawnImpl, calls } = fakeSpawn(() => ({ code: 0 }))
  const runner = createGitRunner({ spawnImpl, sessionRoot: () => 'E:\\ws' })
  await runner.run({ command: 'status' })
  assert.equal(calls[0].opts.env.GIT_LFS_SKIP_SMUDGE, '1')
  assert.equal(calls[0].opts.env.GIT_TERMINAL_PROMPT, '0')
})

// ---------- formatGitResult ----------

test('formatGitResult: tokenizer 拒绝（error 且 exitCode undefined）时显式输出 error', () => {
  assert.equal(formatGitResult({ ok: false, error: '命令包含 shell 元字符 "&"（引号内才允许）' }), 'error: 命令包含 shell 元字符 "&"（引号内才允许）')
})

test('formatGitResult: push 被拒输出警示', () => {
  assert.match(formatGitResult({ ok: false, rejected: true, error: 'push 未获批准' }), /push 未获批准/)
})

test('formatGitResult: 常规失败输出 exit 与 stderr', () => {
  const out = formatGitResult({ ok: false, exitCode: 128, stdout: '', stderr: 'fatal: Authentication failed' })
  assert.match(out, /^exit=128/)
  assert.match(out, /--- stderr ---\nfatal: Authentication failed/)
})

test('formatGitResult: 成功且带代理重试时输出代理提示', () => {
  const out = formatGitResult({ ok: true, exitCode: 0, stdout: 'ok', usedProxy: true, proxy: 'http://127.0.0.1:7897' })
  assert.match(out, /经代理重试: http:\/\/127\.0\.0\.1:7897/)
})

test('formatGitResult: 超时输出 exit=null（超时）', () => {
  assert.match(formatGitResult({ ok: false, exitCode: null, timedOut: true }), /exit=null（超时）/)
})
