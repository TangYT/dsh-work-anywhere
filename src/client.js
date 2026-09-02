/**
 * dsh-work-anywhere 浏览器半：
 *  - 会话头部按钮「远程实验」：每个会话（项目对话）标题栏旁一个独立按钮，
 *    点开只配置该会话所属项目的服务器绑定（绑定存项目根目录 .dsh-remote.json）。
 *  - 设置页「远程控制」：微信 ClawBot 连接（驱动 dsh）+ 项目绑定总览（绑定/换绑/解绑 + 计划状态）。
 * 数据经同源 /api/dsh-remote-lab/* 与 /api/dsh-wechat-channel/* 路由读取（host 半提供）。
 * 失败策略：挂载失败只告警，绝不抛出（外部插件不能让 GUI 启动失败）。
 */
import React from 'react'
import QRCode from 'qrcode'

export const name = 'dsh-work-anywhere'
export const inject = ['slots']

const API = {
  hosts: '/api/dsh-remote-lab/hosts',
  projects: '/api/dsh-remote-lab/workspaces',
  bindings: '/api/dsh-remote-lab/bindings',
  sessionBinding: '/api/dsh-remote-lab/session-binding',
  // 微信 ClawBot 频道（由 dsh-wechat-channel 宿主半提供；未安装时路由 404）
  wcStatus: '/api/dsh-wechat-channel/status',
  wcLogin: '/api/dsh-wechat-channel/login',
  wcVerify: '/api/dsh-wechat-channel/verify',
  wcCancelLogin: '/api/dsh-wechat-channel/cancel-login',
  wcLogout: '/api/dsh-wechat-channel/logout',
  wcSwitch: '/api/dsh-wechat-channel/switch',
}

async function apiGet(url) {
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status))
  return data
}
async function apiSend(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status))
  return data
}

const S = {
  page: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '820px', color: 'var(--dsw-alias-label-primary)' },
  hint: { fontSize: '13px', lineHeight: '1.7', color: 'var(--dsw-alias-label-secondary)' },
  card: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--dsw-alias-bg-layer-1)' },
  cardTitle: { fontSize: '14px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' },
  label: { display: 'block', fontSize: '12px', marginBottom: '4px', color: 'var(--dsw-alias-label-secondary)' },
  input: { width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: '13px' },
  row: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' },
  field: { flex: '1 1 180px', display: 'flex', flexDirection: 'column' },
  btn: { padding: '7px 14px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: '13px' },
  btnSmall: { padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-brand-primary)', cursor: 'pointer', background: 'var(--dsw-alias-brand-primary)', color: '#fff', fontSize: '12px', whiteSpace: 'nowrap' },
  btnPrimary: { padding: '7px 16px', borderRadius: '6px', border: '1px solid var(--dsw-alias-brand-primary)', cursor: 'pointer', background: 'var(--dsw-alias-brand-primary)', color: '#fff', fontSize: '13px', fontWeight: '500' },
  msg: { fontSize: '13px', whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-label-secondary)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' },
  td: { padding: '6px 8px', borderBottom: '1px solid var(--dsw-alias-border-l1)', verticalAlign: 'top' },
  mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '12px', wordBreak: 'break-all', color: 'var(--dsw-alias-label-secondary)' },
  empty: { fontSize: '13px', padding: '8px 0', color: 'var(--dsw-alias-label-secondary)' },
  tag: { display: 'inline-block', padding: '1px 8px', borderRadius: '10px', fontSize: '12px', border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)' },
  tagOk: { display: 'inline-block', padding: '1px 8px', borderRadius: '10px', fontSize: '12px', border: '1px solid var(--dsw-alias-state-success-primary)', color: 'var(--dsw-alias-state-success-primary)' },
  dot: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', marginRight: '8px', verticalAlign: 'middle' },
  dotOn: { background: 'var(--dsw-alias-state-success-primary)' },
  dotOff: { background: 'var(--dsw-alias-border-l2)' },
  qrBox: { display: 'inline-block', background: '#fff', padding: '10px', borderRadius: '8px' },
  qrImg: { width: '220px', height: '220px', display: 'block' },
  link: { fontSize: '12px', color: 'var(--dsw-alias-brand-primary)', wordBreak: 'break-all' },
  select: { padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', maxWidth: '220px' },
  // 弹窗
  backdrop: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', borderRadius: '12px', padding: '18px', width: 'min(560px, 92vw)', maxHeight: '86vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' },
  modalTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' },
  pathLine: { fontSize: '12px', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', color: 'var(--dsw-alias-label-secondary)' },
}

function planText(plan) {
  if (!plan) return '无计划'
  const c = plan.counts || {}
  const parts = []
  if (c.running) parts.push(c.running + ' 运行中')
  if (c.pending) parts.push(c.pending + ' 待启动')
  if (c.succeeded) parts.push(c.succeeded + ' 成功')
  if (c.failed) parts.push(c.failed + ' 失败')
  if (c.stopped) parts.push(c.stopped + ' 已停止')
  if (c.detached) parts.push(c.detached + ' 断线')
  return parts.length ? parts.join(' · ') : '无实验'
}

// ---------- 会话头部按钮 + 项目绑定弹窗 ----------
function BindDialog({ sessionId, onClose }) {
  const [info, setInfo] = React.useState(null)
  const [form, setForm] = React.useState({ alias: '', remoteRoot: '', sudoPassword: '' })
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')

  const loadInfo = React.useCallback(async () => {
    const d = await apiGet(API.sessionBinding + '?sessionId=' + encodeURIComponent(sessionId))
    setInfo(d)
    if (d.binding) {
      setForm({ alias: d.binding.alias, remoteRoot: d.binding.remoteRoot, sudoPassword: d.binding.sudoPassword || '' })
    }
    return d
  }, [sessionId])

  React.useEffect(() => {
    loadInfo().catch((e) => setMsg('加载失败：' + String(e && e.message || e)))
  }, [loadInfo])

  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }))

  const save = async () => {
    if (!form.alias) { setMsg('请选择服务器'); return }
    setBusy(true)
    try {
      await apiSend('POST', API.bindings, {
        sessionId,
        alias: form.alias,
        remoteRoot: form.remoteRoot || undefined,
        sudoPassword: form.sudoPassword || undefined,
      })
      const d = await loadInfo()
      setMsg('已保存：本项目 → ' + form.alias + (d.binding ? '（' + d.binding.remoteRoot + '）' : ''))
    } catch (e) {
      setMsg('保存失败：' + String(e && e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const unbind = async () => {
    if (!info || !info.path) return
    if (!window.confirm('解除本项目的远程工作区绑定？（远端目录与本地产物不受影响）')) return
    setBusy(true)
    try {
      await apiSend('DELETE', API.bindings, { path: info.path })
      await loadInfo()
      setMsg('已解绑本项目')
    } catch (e) {
      setMsg('解绑失败：' + String(e && e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const hosts = (info && info.hosts) || []
  return React.createElement('div', { style: S.backdrop, onClick: (ev) => { if (ev.target === ev.currentTarget) onClose() } },
    React.createElement('div', { style: S.modal },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        React.createElement('div', { style: S.modalTitle }, '远程实验（本项目）'),
        React.createElement('button', { style: S.btnSmall, onClick: onClose }, '关闭')),
      info
        ? React.createElement('div', { style: S.pathLine },
          '项目：' + (info.title || '') + '  ' + (info.path || ''),
          info.binding
            ? React.createElement('div', { style: { marginTop: '4px' } },
              React.createElement('span', { style: S.tagOk }, '已绑定 ' + info.binding.alias + ' → ' + info.binding.remoteRoot))
            : React.createElement('div', { style: { marginTop: '4px' } }, React.createElement('span', { style: S.tag }, '未绑定')))
        : null,
      React.createElement('div', { style: S.row },
        React.createElement('div', { style: S.field },
          React.createElement('label', { style: S.label }, '服务器'),
          hosts.length === 0
            ? React.createElement('div', { style: S.hint }, '请先到侧边栏「SSH」面板添加主机')
            : React.createElement('select', { style: S.input, value: form.alias, onChange: set('alias') },
              React.createElement('option', { value: '', disabled: true }, '选择主机'),
              hosts.map((h) => React.createElement('option', { key: h.alias, value: h.alias }, h.alias + '（' + h.user + '@' + h.host + ':' + h.port + '）')))),
        React.createElement('div', { style: S.field },
          React.createElement('label', { style: S.label }, '远端根目录（可选）'),
          React.createElement('input', { style: S.input, value: form.remoteRoot, onChange: set('remoteRoot'), placeholder: '默认 ~/remote-lab/<项目名>' })),
        React.createElement('div', { style: S.field },
          React.createElement('label', { style: S.label }, 'sudo 密码（可选）'),
          React.createElement('input', { type: 'password', style: S.input, value: form.sudoPassword, onChange: set('sudoPassword'), placeholder: '目标目录需 root 权限时必填' })),
      ),
      React.createElement('div', { style: S.row },
        React.createElement('button', { style: S.btnPrimary, onClick: save, disabled: busy || hosts.length === 0 }, busy ? '保存中…' : '保存绑定'),
        info && info.binding ? React.createElement('button', { style: S.btn, onClick: unbind, disabled: busy }, '解绑') : null),
      msg ? React.createElement('div', { style: S.msg }, msg) : null,
    ))
}

function HeaderBindButton(props) {
  const [open, setOpen] = React.useState(false)
  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      style: S.btnSmall,
      title: '配置本项目绑定的远程服务器与工作区（仅本项目生效）',
      onClick: () => setOpen((o) => !o),
    }, '远程实验'),
    open && props.sessionId
      ? React.createElement(BindDialog, { sessionId: props.sessionId, onClose: () => setOpen(false) })
      : null,
  )
}

// ---------- 微信 ClawBot 远程控制卡片 ----------
function WechatControlCard() {
  const [data, setData] = React.useState(null)
  const [missing, setMissing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')
  const [qrDataUrl, setQrDataUrl] = React.useState('')
  const [verifyCode, setVerifyCode] = React.useState('')

  React.useEffect(() => {
    let alive = true
    let timer = null
    const tick = async () => {
      if (!alive) return
      try {
        setData(await apiGet(API.wcStatus))
        setMissing(false)
      } catch {
        setMissing(true)
      }
      timer = setTimeout(tick, 3000)
    }
    tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  React.useEffect(() => {
    const url = data && data.login ? data.login.qrcodeUrl : ''
    if (!url) { setQrDataUrl(''); return }
    let alive = true
    QRCode.toDataURL(url, { width: 220, margin: 1 })
      .then((u) => { if (alive) setQrDataUrl(u) })
      .catch(() => { if (alive) setQrDataUrl('') })
    return () => { alive = false }
  }, [data && data.login && data.login.qrcodeUrl])

  const act = async (fn, okText) => {
    setBusy(true)
    setMsg('')
    try {
      const r = await fn()
      if (okText) setMsg(okText)
      if (r) setData(await apiGet(API.wcStatus))
    } catch (e) {
      setMsg('⚠ ' + String(e && e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const connected = data && data.connected
  const login = data && data.login

  return React.createElement('div', { style: S.card },
    React.createElement('div', { style: S.cardTitle }, '微信 / 飞书远程控制'),
    missing
      ? React.createElement('div', { style: S.hint }, '微信频道插件（dsh-wechat-channel）未安装或未加载，无法在此连接微信。')
      : React.createElement(React.Fragment, null,
        React.createElement('div', { style: { ...S.row, alignItems: 'center' } },
          React.createElement('span', { style: { fontSize: '14px' } },
            React.createElement('span', { style: { ...S.dot, ...(connected ? S.dotOn : S.dotOff) } }),
            connected ? '已连接微信 ClawBot · ' + connected.accountId : '未连接微信'),
          connected
            ? React.createElement('button', { style: S.btn, disabled: busy, onClick: () => act(() => apiSend('POST', API.wcLogout), '已断开') }, busy ? '处理中…' : '断开连接')
            : React.createElement('button', { style: S.btnPrimary, disabled: busy || !!login, onClick: () => act(() => apiSend('POST', API.wcLogin)) }, busy ? '处理中…' : '连接微信'),
          login ? React.createElement('button', { style: S.btn, onClick: () => act(() => apiSend('POST', API.wcCancelLogin), '已取消') }, '取消') : null),
        connected
          ? React.createElement('div', { style: S.hint }, '在微信里给该 ClawBot 发消息即可控制 dsh（项目查询 /projects、切换 /switch <编号|名称>、状态 /status、帮助 /help）。')
          : null,
        login && login.phase === 'qr'
          ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' } },
            React.createElement('div', { style: S.hint }, login.message || '请用手机微信扫码'),
            qrDataUrl
              ? React.createElement('div', { style: S.qrBox }, React.createElement('img', { style: S.qrImg, src: qrDataUrl, alt: 'wechat qr' }))
              : null,
            React.createElement('a', { style: S.link, href: login.qrcodeUrl, target: '_blank', rel: 'noreferrer' }, '二维码无法显示时点击此链接'))
          : null,
        login && login.phase === 'scanned'
          ? React.createElement('div', { style: S.msg }, '已扫码，正在手机上确认…')
          : null,
        login && login.phase === 'verify'
          ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' } },
            React.createElement('div', { style: S.hint }, login.message || '请输入手机微信上显示的数字'),
            React.createElement('div', { style: S.row },
              React.createElement('input', { style: S.input, value: verifyCode, onChange: (e) => setVerifyCode(e.target.value), placeholder: '验证数字', autoFocus: true }),
              React.createElement('button', { style: S.btnPrimary, disabled: busy || !verifyCode.trim(), onClick: () => act(() => apiSend('POST', API.wcVerify, { code: verifyCode.trim() }).then(() => setVerifyCode(''))) }, '提交')))
          : null,
        login && login.phase === 'error'
          ? React.createElement('div', { style: S.msg }, '⚠ ' + (login.message || '登录失败'))
          : null,
        data && data.peers && data.peers.length > 0
          ? React.createElement('table', { style: S.table },
            React.createElement('tbody', null,
              data.peers.map((p) => {
                const opts = (data.projects || []).map((pr) =>
                  React.createElement('option', { key: pr.path, value: pr.path }, pr.title + (pr.remote ? '（远程）' : '')),
                )
                return React.createElement('tr', { key: p.peerId },
                  React.createElement('td', { style: { ...S.td, ...S.mono } }, p.peerId),
                  React.createElement('td', { style: S.td },
                    React.createElement('select', {
                      style: S.select,
                      value: p.project,
                      onChange: (e) => act(() => apiSend('POST', API.wcSwitch, { peerId: p.peerId, project: e.target.value }), '已切换'),
                    }, opts),
                  ),
                )
              }),
            ),
          )
          : null,
        msg ? React.createElement('div', { style: S.msg }, msg) : null,
        React.createElement('div', { style: S.hint }, '微信 ClawBot 插件一次只能连接一个端点（与整个 dsh web 绑定）。飞书通道暂未提供，后续可在此处扩展。')),
  )
}

// ---------- 设置页（远程控制：微信通道 + 项目绑定总览） ----------
function RemoteLabPage(_props) {
  const [hosts, setHosts] = React.useState([])
  const [projects, setProjects] = React.useState([])
  const [form, setForm] = React.useState({ path: '', alias: '', remoteRoot: '', sudoPassword: '' })
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState('')

  const load = React.useCallback(async () => {
    try {
      const [h, p] = await Promise.all([apiGet(API.hosts), apiGet(API.projects)])
      setHosts(h.hosts || [])
      setProjects(p.projects || [])
      setMessage('')
    } catch (e) {
      setMessage('加载失败：' + String(e && e.message || e))
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const set = (k) => (ev) => setForm((f) => ({ ...f, [k]: ev.target.value }))

  const pickProject = (path) => {
    const p = projects.find((x) => x.path === path)
    setForm((f) => ({
      ...f,
      path,
      alias: (p && p.binding && p.binding.alias) || f.alias,
      remoteRoot: (p && p.binding && p.binding.remoteRoot) || f.remoteRoot,
      sudoPassword: (p && p.binding && p.binding.sudoPassword) || f.sudoPassword,
    }))
  }

  const submit = async () => {
    if (!form.path) { setMessage('请选择项目'); return }
    if (!form.alias) { setMessage('请选择服务器'); return }
    setBusy(true)
    const project = projects.find((x) => x.path === form.path)
    const wasBound = !!(project && project.binding)
    try {
      await apiSend('POST', API.bindings, {
        path: form.path,
        alias: form.alias,
        remoteRoot: form.remoteRoot || undefined,
        sudoPassword: form.sudoPassword || undefined,
      })
      await load()
      setMessage((wasBound ? '已换绑' : '已绑定') + '：' + (project ? project.title : form.path) + ' → ' + form.alias)
    } catch (e) {
      setMessage('失败：' + String(e && e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const unbind = async (p) => {
    if (!window.confirm('解除「' + p.title + '」的远程工作区绑定？（远端目录与本地产物不受影响）')) return
    try {
      await apiSend('DELETE', API.bindings, { path: p.path })
      await load()
      setMessage('已解绑：' + p.title)
    } catch (e) {
      setMessage('解绑失败：' + String(e && e.message || e))
    }
  }

  return React.createElement('div', { style: S.page },
    React.createElement('div', { style: S.hint },
      '「远程控制」= 微信/飞书驱动 dsh + 项目远程工作区。对话标题栏的「远程实验」按钮可快捷配置当前项目绑定；微信连接与整个 dsh web 绑定（不按项目/对话）。'),
    React.createElement(WechatControlCard, null),
    React.createElement('div', { style: S.card },
      React.createElement('div', { style: S.cardTitle }, '项目绑定 / 换绑'),
      React.createElement('div', { style: S.row },
        React.createElement('div', { style: S.field },
          React.createElement('label', { style: S.label }, '项目'),
          projects.length === 0
            ? React.createElement('div', { style: S.hint }, '暂无项目（DSH 工作区）')
            : React.createElement('select', { style: S.input, value: form.path, onChange: (ev) => pickProject(ev.target.value) },
              React.createElement('option', { value: '', disabled: true }, '选择项目'),
              projects.map((p) => React.createElement('option', { key: p.id, value: p.path },
                p.title + (p.binding ? '（当前: ' + p.binding.alias + '）' : '（未绑定）'))))),
        React.createElement('div', { style: S.field },
          React.createElement('label', { style: S.label }, '服务器'),
          hosts.length === 0
            ? React.createElement('div', { style: S.hint }, '请先到侧边栏「SSH」面板添加主机')
            : React.createElement('select', { style: S.input, value: form.alias, onChange: set('alias') },
              React.createElement('option', { value: '', disabled: true }, '选择主机'),
              hosts.map((h) => React.createElement('option', { key: h.alias, value: h.alias }, h.alias + '（' + h.user + '@' + h.host + ':' + h.port + '）')))),
        React.createElement('div', { style: S.field },
          React.createElement('label', { style: S.label }, '远端根目录（可选）'),
          React.createElement('input', { style: S.input, value: form.remoteRoot, onChange: set('remoteRoot'), placeholder: '默认 ~/remote-lab/<项目名>' })),
      ),
      React.createElement('div', { style: S.row },
        React.createElement('div', { style: S.field },
          React.createElement('label', { style: S.label }, 'sudo 密码（可选）'),
          React.createElement('input', { type: 'password', style: S.input, value: form.sudoPassword, onChange: set('sudoPassword'), placeholder: '目标目录需 root 权限时必填' })),
        React.createElement('button', { style: S.btnPrimary, onClick: submit, disabled: busy || hosts.length === 0 || projects.length === 0 }, busy ? '处理中…' : '绑定 / 换绑'),
      ),
    ),
    React.createElement('div', { style: S.card },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        React.createElement('div', { style: S.cardTitle }, '项目与绑定'),
        React.createElement('button', { style: S.btn, onClick: load }, '刷新')),
      projects.length === 0
        ? React.createElement('div', { style: S.empty }, '暂无项目（DSH 工作区）。')
        : React.createElement('table', { style: S.table },
          React.createElement('tbody', null,
            projects.map((p) =>
              React.createElement('tr', { key: p.id },
                React.createElement('td', { style: S.td }, p.title),
                React.createElement('td', { style: { ...S.td, ...S.mono } }, p.path),
                React.createElement('td', { style: S.td },
                  p.binding
                    ? React.createElement('span', { style: S.tagOk }, p.binding.alias + ' → ' + p.binding.remoteRoot)
                    : React.createElement('span', { style: S.tag }, '未绑定')),
                React.createElement('td', { style: S.td }, planText(p.plan)),
                React.createElement('td', { style: S.td },
                  React.createElement('button', { style: S.btn, onClick: () => pickProject(p.path) }, '换绑'),
                  ' ',
                  p.binding ? React.createElement('button', { style: S.btn, onClick: () => unbind(p) }, '解绑') : null))))),
    ),
    message ? React.createElement('div', { style: S.msg }, message) : null,
  )
}

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  ctx.effect(() => {
    const disposers = []
    try {
      const unsubSettings = slots.inject('settings.section', () => {
        const unreg = slots.register(
          { name: 'settings.section', id: 'remote-lab', order: 160, label: '远程控制' },
          (props) => React.createElement(RemoteLabPage, props),
        )
        if (typeof unreg === 'function') disposers.push(unreg)
      })
      if (typeof unsubSettings === 'function') disposers.push(unsubSettings)
    } catch (e) {
      console.warn('[remote-lab] settings mount failed:', e)
    }
    try {
      const unsubHeader = slots.inject('conversation.session.header.actions', () => {
        const unreg = slots.register(
          { name: 'conversation.session.header.actions', id: 'remote-lab', order: 30, label: '远程实验' },
          (props) => React.createElement(HeaderBindButton, props),
        )
        if (typeof unreg === 'function') disposers.push(unreg)
      })
      if (typeof unsubHeader === 'function') disposers.push(unsubHeader)
    } catch (e) {
      console.warn('[remote-lab] header action mount failed:', e)
    }
    return () => { for (const d of disposers) { try { d() } catch {} } }
  })
}
