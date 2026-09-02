// dsh-remote-lab 冒烟测试（含绑定解析安全用例）：
// 用假 ctx 直接调用 apply，校验工具 schema 根级规范化，并验证严格项目绑定：
//   A. 显式绝对路径 → 仅该目录本身命中
//   B. 未绑定项目位于已绑定项目内部 → NO_BINDING（漏洞回归测试）
//   C. 已绑定项目的子目录会话 → 命中项目根绑定（保留的子目录归属行为）
//   D. 显式路径指向已绑定项目内的无绑定子目录 → NO_BINDING（不再向上继承）
// 用法：node test/smoke.mjs （不访问真实网络/服务器）
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.REMLAB_ROOT = join(tmpdir(), 'remlab-legacy-smoke') // 隔离 legacy 数据根（必须先于插件模块加载）
const { apply, name, inject, validateWsName, validateRemoteRoot, normalizeSshHost, pickBindingForCwd, buildServerContextLine } = await import('../lib/remote-lab.js')

// ---------- 可变假状态（apply 捕获的 services 闭包引用它） ----------
const fakeState = { sessionCwd: undefined, workspaces: [], registryBroken: false }
const registered = []
const sections = []
const routes = []
const listeners = {}
const fakeCtx = {
  get(svc) {
    if (svc === 'agents') {
      return { currentInitiator: () => (fakeState.sessionCwd ? { session: { cwd: fakeState.sessionCwd } } : undefined) }
    }
    if (svc === 'workspaceRegistry') {
      if (fakeState.registryBroken) return undefined // 模拟注册表不可用（服务缺失/未就绪）
      return { list: () => fakeState.workspaces.map((w) => ({ ...w })) }
    }
    return undefined
  },
  effect: (fn) => { try { return fn() } catch (e) { console.error('effect init failed:', e.message); return () => {} } },
  tools: { register: (def) => { registered.push(def); return () => {} } },
  systemPrompt: { section: (s) => { sections.push(s.name); return () => {} } },
  webServer: { register: (route) => { routes.push(route.kind + ' ' + route.path); return () => {} } },
  on: (name, fn) => { listeners[name] = fn; return () => { delete listeners[name] } },
}

let error = null
try { apply(fakeCtx) } catch (e) { error = e }

console.log('plugin name =', name)
console.log('inject      =', JSON.stringify(inject))
console.log('tools       =', registered.length)
console.log('sections    =', sections.join(', ') || '(none)')
console.log('routes      =', routes.join(', ') || '(none)')

let schemaErrors = 0
for (const def of registered) {
  const p = def.parameters
  const ok = p && p.type === 'object' && p.properties && typeof p.properties === 'object'
  if (!ok) {
    schemaErrors++
    console.error('BAD SCHEMA:', def.name, JSON.stringify(p))
    continue
  }
  const reqs = (p.required || []).filter((k) => !Object.hasOwn(p.properties, k))
  if (reqs.length > 0) {
    schemaErrors++
    console.error('BAD REQUIRED:', def.name, reqs.join(','))
  }
  console.log('  ok', def.name, 'params:', Object.keys(p.properties).length, 'required:', (p.required || []).join(',') || '-')
}

if (error) {
  console.error('APPLY FAILED:', error && error.stack)
  process.exit(1)
} else if (schemaErrors > 0) {
  console.error('SCHEMA CHECK FAILED:', schemaErrors)
  process.exit(1)
} else {
  console.log('APPLY OK + SCHEMA OK')
}

// ---------- 绑定解析安全用例（纯本地，不触网） ----------
const statusTool = registered.find((d) => d.name === 'remlab_plan_status')
if (!statusTool) { console.error('缺少 remlab_plan_status'); process.exit(1) }
const NO_BINDING_MARK = '当前项目未绑定'
const PLAN_MISSING_MARK = '该项目还没有实验计划'

const base = await mkdtemp(join(tmpdir(), 'remlab-sec-'))
const boundProj = join(base, 'bound-proj')          // 已绑定项目
const unboundProj = join(boundProj, 'inner-proj')   // 已绑定项目内部的未绑定项目
const boundSub = join(boundProj, 'subdir')          // 已绑定项目的普通子目录
await mkdir(unboundProj, { recursive: true })
await mkdir(boundSub, { recursive: true })
await writeFile(join(boundProj, '.dsh-remote.json'), JSON.stringify({ version: 1, name: 'boundproj', alias: 'smoke-host', remoteRoot: '/tmp/remlab-smoke' }), 'utf8')

let failed = 0
async function expectCase(label, args, cwd, workspaces, mark, registryBroken) {
  fakeState.sessionCwd = cwd
  fakeState.workspaces = workspaces || []
  fakeState.registryBroken = !!registryBroken
  const out = String(await statusTool.execute(args || {}) || '')
  if (out.includes(mark)) {
    console.log('PASS ' + label + ' → ' + mark)
  } else {
    failed++
    console.error('FAIL ' + label + '\n  期望包含: ' + mark + '\n  实际输出: ' + out.slice(0, 300))
  }
}

// A. 显式绝对路径 → 仅该目录本身
await expectCase('A 显式路径=绑定项目根', { name: boundProj }, undefined, [], PLAN_MISSING_MARK)
// B. 漏洞回归：未绑定项目（已注册工作区）位于已绑定项目内部 → 必须 NO_BINDING
await expectCase('B 未绑定项目不继承祖先绑定', {}, unboundProj, [{ id: 'w1', path: boundProj }, { id: 'w2', path: unboundProj }], NO_BINDING_MARK)
// C. 已绑定项目的子目录会话 → 命中项目根绑定（保留行为）
await expectCase('C 子目录归属项目根绑定', {}, boundSub, [{ id: 'w1', path: boundProj }], PLAN_MISSING_MARK)
// D. 显式路径=绑定项目内的无绑定子目录 → NO_BINDING（不再向上继承）
await expectCase('D 显式子目录路径不向上继承', { name: unboundProj }, undefined, [], NO_BINDING_MARK)
// E. 会话 cwd 不在任何已注册工作区内 → NO_BINDING（即使目录树内有绑定文件）
await expectCase('E 未注册工作区不解析绑定', {}, boundSub, [], NO_BINDING_MARK)
// F. 显式 legacy 名 → 命中 legacy 目录（保留行为）
await mkdir(join(process.env.REMLAB_ROOT, 'legacyws'), { recursive: true })
await writeFile(join(process.env.REMLAB_ROOT, 'legacyws', 'remote.json'), JSON.stringify({ version: 1, name: 'legacyws', alias: 'smoke-host', remoteRoot: '/tmp/remlab-legacy' }), 'utf8')
await expectCase('F 显式 legacy 名仍可用', { name: 'legacyws' }, undefined, [], PLAN_MISSING_MARK)
// G. 注册表不可用 + cwd 自身即绑定项目根 → 仍可解析（恢复路径，精确目录，无继承）
await expectCase('G 注册表不可用但cwd自绑定', {}, boundProj, [], PLAN_MISSING_MARK, true)
// H. 注册表不可用 + cwd 为已绑定项目的子目录（子目录自身无绑定）→ NO_BINDING（不借注册表也不向上继承）
await expectCase('H 注册表不可用子目录不继承', {}, boundSub, [], NO_BINDING_MARK, true)

// ---------- 服务器速查：严格作用域挑选 + 一次性注入（隐私：只含本会话绑定服务器） ----------
const B1 = [{ path: boundProj, alias: 'smoke-host', remoteRoot: '/tmp/remlab-smoke' }]
if ((pickBindingForCwd(B1, boundProj, undefined) || {}).alias !== 'smoke-host') { console.error('FAIL 挑选: 精确目录未命中'); process.exit(1) }
if ((pickBindingForCwd(B1, boundSub, boundProj) || {}).alias !== 'smoke-host') { console.error('FAIL 挑选: 子目录经项目根未命中'); process.exit(1) }
if (pickBindingForCwd(B1, unboundProj, unboundProj) !== undefined) { console.error('FAIL 挑选: 嵌套未绑定项目继承了祖先绑定'); process.exit(1) }
if (pickBindingForCwd(B1, boundSub, undefined) !== undefined) { console.error('FAIL 挑选: 无项目根时向上继承'); process.exit(1) }
if (pickBindingForCwd(B1, undefined, undefined) !== undefined) { console.error('FAIL 挑选: 无 cwd 未返回 undefined'); process.exit(1) }
const line1 = buildServerContextLine({ path: boundProj, alias: 'smoke-host', remoteRoot: '/tmp/remlab-smoke', host: { host: '1.2.3.4', port: 22, user: 'tyt', auth: 'key' } })
if (!line1.includes('smoke-host') || !line1.includes('/tmp/remlab-smoke') || !line1.includes('1.2.3.4') || !line1.includes('密钥认证')) { console.error('FAIL 文案: 缺绑定信息 → ' + line1); process.exit(1) }
if (line1.includes('A800') || line1.includes('robot')) { console.error('FAIL 文案: 泄露其他主机 → ' + line1); process.exit(1) }
console.log('PASS 服务器速查（严格作用域 + 单台隐私）')

// 一次性注入模拟：resume 触发 agent/session-start → 注入一条（缓存未命中时异步刷新后注入）
const sessionStart = listeners['agent/session-start']
if (typeof sessionStart !== 'function') { console.error('缺少 agent/session-start 监听'); process.exit(1) }
fakeState.workspaces = [{ id: 'w1', path: boundProj }]
fakeState.registryBroken = false
const injected = []
const injAgent = { id: 'inj-1', session: { cwd: boundSub }, inject(m) { injected.push(m) } }
sessionStart({ agent: injAgent, source: 'resume' })
const injDeadline = Date.now() + 5000
while (injected.length < 1 && Date.now() < injDeadline) await new Promise((r) => setTimeout(r, 25))
if (injected.length !== 1) { console.error('FAIL 注入: 未注入或多次注入（count=' + injected.length + '）'); process.exit(1) }
const injText = injected[0].content[0].text
if (!injText.includes('smoke-host') || injText.includes('A800') || injText.includes('robot')) { console.error('FAIL 注入内容: ' + injText); process.exit(1) }
const injAgent2 = { id: 'inj-2', session: { cwd: boundSub }, inject(m) { injected.push(m) } }
sessionStart({ agent: injAgent2, source: 'compact' })
await new Promise((r) => setTimeout(r, 150))
if (injected.length !== 1) { console.error('FAIL 注入: compact 不应再次注入（count=' + injected.length + '）'); process.exit(1) }
console.log('PASS 一次性服务器注入（仅 resume/startup，仅本会话绑定服务器）')

await rm(base, { recursive: true, force: true })
await rm(process.env.REMLAB_ROOT, { recursive: true, force: true })

if (failed > 0) {
  console.error('SECURITY CASES FAILED:', failed)
  process.exit(1)
}
console.log('SECURITY CASES OK（严格项目绑定生效）')

// ---------- 目录名校验用例（含空格目录名回归） ----------
const nameCases = [
  ['空格目录名通过（回归: robot dog）', 'robot dog', null],
  ['CJK 目录名通过', '机器人项目', null],
  ['普通目录名通过', 'robot_dog-v2', null],
  ['带点目录名通过', 'robot.dog v2', null],
  ['空名拒绝', '', 'error'],
  ['超长名拒绝', 'x'.repeat(61), 'error'],
  ['双引号拒绝', 'robot"dog', 'error'],
  ['美元符拒绝', 'robot$dog', 'error'],
  ['反引号拒绝', 'robot`dog`', 'error'],
  ['控制字符拒绝', 'robot\ndog', 'error'],
]
const rootCases = [
  ['remoteRoot 含空格通过', '/tmp/remote lab', null],
  ['remoteRoot 普通路径通过', '/home/u/remote-lab/robot-dog', null],
  ['remoteRoot 含 $ 拒绝', '/tmp/remote$lab', 'error'],
  ['remoteRoot 空拒绝', '', 'error'],
]
let valFailed = 0
for (const [label, input, expect] of nameCases) {
  const err = validateWsName(input)
  const ok = expect === null ? err === null : err !== null
  if (ok) console.log('PASS 名称校验: ' + label)
  else { valFailed++; console.error('FAIL 名称校验: ' + label + ' → err=' + err) }
}
for (const [label, input, expect] of rootCases) {
  const err = validateRemoteRoot(input)
  const ok = expect === null ? err === null : err !== null
  if (ok) console.log('PASS remoteRoot 校验: ' + label)
  else { valFailed++; console.error('FAIL remoteRoot 校验: ' + label + ' → err=' + err) }
}
if (valFailed > 0) {
  console.error('VALIDATION CASES FAILED:', valFailed)
  process.exit(1)
}
console.log('VALIDATION CASES OK（含空格目录名可绑定）')

// ---------- SSH 主机规范化用例（密码认证必须透传，否则密码主机无法绑定） ----------
const pwHost = normalizeSshHost({ alias: 'r', host: '1.2.3.4', port: 22, user: 'tyt', auth: { kind: 'password', password: 'sekret' } })
if (pwHost.password !== 'sekret' || pwHost.keyPath !== undefined || pwHost.passphrase !== undefined || pwHost.port !== 22) {
  console.error('FAIL 主机规范化: 密码认证未透传 → ' + JSON.stringify({ password: !!pwHost.password, keyPath: pwHost.keyPath }))
  process.exit(1)
}
const keyHost = normalizeSshHost({ alias: 'a', host: 's4.s100.vip', port: 35418, user: 'tyt', auth: { kind: 'key', keyPath: 'C:/k', passphrase: 'p' } })
if (keyHost.keyPath !== 'C:/k' || keyHost.passphrase !== 'p' || keyHost.password !== undefined || keyHost.port !== 35418) {
  console.error('FAIL 主机规范化: 密钥认证字段异常 → ' + JSON.stringify(keyHost))
  process.exit(1)
}
const bareHost = normalizeSshHost({ alias: 'b', host: 'h', user: 'u' })
if (bareHost.port !== 22 || bareHost.password !== undefined || bareHost.keyPath !== undefined) {
  console.error('FAIL 主机规范化: 缺省字段异常 → ' + JSON.stringify(bareHost))
  process.exit(1)
}
console.log('PASS 主机规范化（密码/密钥/缺省端口）')

// ---------- 空格目录名绑定端到端回归（不应再被校验拦截，应推进到 SSH 别名检查） ----------
const initTool = registered.find((d) => d.name === 'remlab_ws_init')
if (!initTool) { console.error('缺少 remlab_ws_init'); process.exit(1) }
const spaceBase = await mkdtemp(join(tmpdir(), 'remlab-space-'))
const spaceProj = join(spaceBase, 'robot dog')
await mkdir(spaceProj, { recursive: true })
const initOut = String(await initTool.execute({ path: spaceProj, alias: 'smoke-host' }) || '')
await rm(spaceBase, { recursive: true, force: true })
if (initOut.includes('项目目录名')) {
  console.error('FAIL 空格目录名绑定回归: 仍被名称校验拦截 → ' + initOut.slice(0, 200))
  process.exit(1)
}
if (!initOut.includes('alias 不在')) {
  console.error('FAIL 空格目录名绑定回归: 预期推进到 SSH 别名检查，实际 → ' + initOut.slice(0, 200))
  process.exit(1)
}
console.log('PASS 空格目录名绑定回归（校验放行，推进到 SSH 阶段）')

// 让延迟扫描定时器没有机会真正执行（apply 内 3 秒后触发）
setTimeout(() => process.exit(0), 50)
