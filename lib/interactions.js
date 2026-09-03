/**
 * dsh-work-anywhere · 微信交互桥（interaction bridge）
 *
 * 扮演「无头 Web 客户端」：订阅本机 /api/events.mux SSE（审批/问答帧，连接时服务端自动
 * 重放当前全部 pending → 断线重连不漏帧），把微信会话的交互请求转发到微信对端，并把
 * 微信回复经 POST /api/respond（官方 client-response 格式）交还给 Web answerer——
 * Web 界面仍显示可交互选项，但微信端也能回答并推进会话。非微信会话的帧一律忽略。
 *
 * 覆盖三类交互：审批（approval/requested）、选项问答（question/requested，含
 * ask_user_question）、计划评审（question/requested + intent.kind='plan-review'）。
 */
export function createInteractionBridge(deps) {
  const {
    ctx, log, isConnected, findPeerBySession, ensurePeer, sendChunked,
    timeoutMs = 600000,
  } = deps
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // 每对端一个 FIFO 队列（agent 回合按序阻塞，同一时刻通常只有一个交互）
  const queues = new Map() // peerId -> [rpcId]
  const pending = new Map() // rpcId -> item
  let aborter = null

  const approveRe = /^(允许|同意|批准|approve|approved|ok|y|yes|1|true)$/i
  function webBase() {
    try {
      const ws = ctx.webServer || ctx.get('webServer')
      if (!ws || !ws.port) return null
      const host = ws.host && ws.host !== '0.0.0.0' && ws.host !== '::' ? ws.host : '127.0.0.1'
      return 'http://' + host + ':' + ws.port
    } catch { return null }
  }

  async function postRespond(rpcId, value, errorCode) {
    const base = webBase()
    if (!base) { log('interaction bridge: webServer 端口不可用'); return false }
    try {
      const body = errorCode
        ? { type: 'client-response', rpcId, result: { ok: false, error: { code: errorCode, message: 'answered via wechat interaction bridge' } } }
        : { type: 'client-response', rpcId, result: { ok: true, value } }
      const res = await fetch(base + '/api/respond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) return false
      const receipt = await res.json().catch(() => null)
      return !!receipt && receipt.accepted === true
    } catch (e) {
      log('interaction bridge respond failed:', e && e.message)
      return false
    }
  }

  // ---------- 帧处理 ----------
  function handleFrame(frame) {
    const p = frame && frame.payload
    if (!p || typeof p.type !== 'string') return
    try {
      if (p.type === 'approval/requested') {
        const hit = findPeerBySession(p.sessionId)
        if (!hit || !isConnected()) return // 非微信会话 → Web 端照常处理
        enqueue(hit, {
          kind: 'approval', rpcId: frame.rpcId, sessionId: p.sessionId,
          approvalId: p.approvalId, toolName: p.toolName, reason: p.reason,
        })
      } else if (p.type === 'question/requested') {
        const hit = findPeerBySession(p.sessionId)
        if (!hit || !isConnected()) return
        if (!Array.isArray(p.questions) || p.questions.length === 0) return
        enqueue(hit, {
          kind: 'question', rpcId: frame.rpcId, sessionId: p.sessionId,
          questions: p.questions, stage: 0, answers: [],
        })
      } else if (p.type === 'approval/resolved' || p.type === 'question/resolved') {
        handleResolved(p)
      }
    } catch (e) { log('interaction bridge frame error:', e && e.message) }
  }
  function handleResolved(p) {
    for (const [rpcId, item] of pending) {
      if (item.sessionId !== p.sessionId) continue
      const match = (p.type === 'approval/resolved' && item.kind === 'approval' && item.approvalId === p.approvalId) ||
        (p.type === 'question/resolved' && item.rpcId === p.questionRpcId)
      if (!match) continue
      const peerId = ownerPeerOf(rpcId)
      if (item.timer) clearTimeout(item.timer)
      pending.delete(rpcId)
      removeFromQueue(peerId, rpcId)
      if (peerId) {
        const label = p.type === 'approval/resolved'
          ? (p.outcome === 'allowed-once' ? '已放行' : p.outcome === 'rejected' ? '已拒绝' : '已取消')
          : (p.outcome === 'answered' ? '已回答' : '已取消')
        sendChunked(peerId, ensurePeer(peerId), 'ℹ️ 该交互已在 Web 端处理（' + label + '），微信侧等待结束').catch(() => {})
        dispatchHead(peerId)
      }
      return
    }
  }
  function ownerPeerOf(rpcId) {
    for (const [peerId, q] of queues) if (q.includes(rpcId)) return peerId
    return null
  }
  function removeFromQueue(peerId, rpcId) {
    const q = queues.get(peerId)
    if (!q) return
    const i = q.indexOf(rpcId)
    if (i !== -1) q.splice(i, 1)
    if (!q.length) queues.delete(peerId)
  }
  function enqueue(hit, item) {
    const q = queues.get(hit.peerId) || []
    q.push(item.rpcId)
    queues.set(hit.peerId, q)
    pending.set(item.rpcId, item)
    if (q.length === 1) dispatchHead(hit.peerId)
  }
  function dispatchHead(peerId) {
    const q = queues.get(peerId)
    const rpcId = q && q[0]
    const item = rpcId && pending.get(rpcId)
    if (!item || item.prompted) return
    item.prompted = true
    const peer = ensurePeer(peerId)
    if (item.kind === 'approval') {
      const lines = ['🔐 审批请求', '工具: ' + item.toolName]
      if (item.reason) lines.push('原因: ' + item.reason)
      lines.push('回复『允许/同意/1』= 本次放行；其他回复 = 拒绝', '（10 分钟内未回复将自动拒绝）')
      sendChunked(peerId, peer, lines.join('\n')).catch(() => {})
      item.timer = setTimeout(() => {
        log('interaction timeout (reject): ' + item.rpcId)
        handleReply(peerId, item, '拒绝')
      }, timeoutMs)
    } else {
      sendQuestion(peerId, item, 0).catch(() => {})
    }
  }

  async function sendQuestion(peerId, item, index) {
    const peer = ensurePeer(peerId)
    const q = item.questions[index]
    const multi = item.questions.length > 1
    if (q.intent && q.intent.kind === 'plan-review') {
      if (multi) sendChunked(peerId, peer, '【问题 ' + (index + 1) + '/' + item.questions.length + '】').catch(() => {})
      if (q.header) sendChunked(peerId, peer, '『' + q.header + '』').catch(() => {})
      if (q.detail) {
        sendChunked(peerId, peer, '--- 计划全文 ---').catch(() => {})
        await sendChunked(peerId, peer, q.detail)
      }
      await sendChunked(peerId, peer, "回复『批准/同意/1』= 离开计划模式并执行计划；其他回复 = 继续打磨（可直接附反馈意见）")
      return
    }
    const lines = []
    if (multi) lines.push('【问题 ' + (index + 1) + '/' + item.questions.length + '】')
    if (q.header) lines.push('『' + q.header + '』')
    lines.push(q.question)
    if (q.detail) lines.push('（补充说明）' + q.detail)
    const opts = q.options || []
    if (opts.length) {
      lines.push('选项:')
      opts.forEach((o, i) => lines.push((i + 1) + '. ' + o.label + (o.description ? ' — ' + o.description : '')))
      if (q.multiSelect === true) lines.push('（多选：回复多个编号，用逗号分隔）')
      lines.push('回复编号或选项文本；也可直接回复自定义内容')
    } else {
      lines.push('（请直接回复你的答案）')
    }
    await sendChunked(peerId, peer, lines.join('\n'))
  }

  // ---------- 微信回复解析与递交 ----------
  function parseAnswer(q, text) {
    const t = String(text).trim()
    if (q.intent && q.intent.kind === 'plan-review') {
      return approveRe.test(t)
        ? { id: q.id, selected: [q.intent.approve] }
        : { id: q.id, selected: [], custom: t }
    }
    const opts = q.options || []
    if (opts.length) {
      const parts = t.split(/[,，、\s]+/).filter(Boolean)
      if (parts.length && parts.every((n) => /^\d+$/.test(n))) {
        const idxs = parts.map((n) => parseInt(n, 10) - 1)
        if (idxs.every((i) => i >= 0 && i < opts.length)) {
          const labels = [...new Set(idxs.map((i) => opts[i].label))]
          if (q.multiSelect === true) return { id: q.id, selected: labels }
          if (labels.length === 1) return { id: q.id, selected: labels }
          return null // 单选给了多个编号 → 需要重新回答
        }
        return null
      }
      const hit = opts.find((o) => o.label === t)
      if (hit) return { id: q.id, selected: [hit.label] }
    }
    return { id: q.id, selected: [], custom: t }
  }

  async function handleReply(peerId, item, text) {
    const peer = ensurePeer(peerId)
    if (item.kind === 'approval') {
      const outcome = approveRe.test(String(text).trim()) ? 'allowed-once' : 'rejected'
      clearItem(peerId, item)
      const ok = await postRespond(item.rpcId, { sessionId: item.sessionId, approvalId: item.approvalId, outcome })
      if (!ok) await sendChunked(peerId, peer, '⚠ 审批答复递交失败，请稍后重试或到 Web 端处理')
      else await sendChunked(peerId, peer, outcome === 'allowed-once' ? '✅ 已放行本次操作，继续推进' : '⛔ 已拒绝该操作（失败关闭）')
      dispatchHead(peerId)
      return
    }
    const q = item.questions[item.stage]
    const ans = parseAnswer(q, text)
    if (ans === null) {
      await sendChunked(peerId, peer, '⚠ 无法解析该回答（单选请只给一个编号/选项），请重新回复')
      return
    }
    item.answers.push(ans)
    if (item.stage < item.questions.length - 1) {
      item.stage++
      await sendQuestion(peerId, item, item.stage)
      return
    }
    clearItem(peerId, item)
    const ok = await postRespond(item.rpcId, { sessionId: item.sessionId, answer: { answers: item.answers } })
    if (!ok) await sendChunked(peerId, peer, '⚠ 回答递交失败，请稍后重试或到 Web 端处理')
    else await sendChunked(peerId, peer, '✅ 已收到回答，继续推进')
    dispatchHead(peerId)
  }
  function clearItem(peerId, item) {
    if (item.timer) clearTimeout(item.timer)
    pending.delete(item.rpcId)
    removeFromQueue(peerId, item.rpcId)
  }
  function clearAll() {
    for (const [rpcId, item] of pending) {
      if (item.timer) clearTimeout(item.timer)
      pending.delete(rpcId)
    }
    queues.clear()
  }

  /** 对端下一条入站消息：有挂起交互 → 交付等待器并返回 true；否则 false（走正常路由）。 */
  async function deliver(peerId, text) {
    const q = queues.get(peerId)
    const rpcId = q && q[0]
    const item = rpcId && pending.get(rpcId)
    if (!item) return false
    await handleReply(peerId, item, text)
    return true
  }

  // ---------- SSE 长连接（连接即重放 pending；断开自动重连） ----------
  async function bridgeLoop(signal) {
    while (!signal.aborted) {
      if (!isConnected()) { clearAll(); await sleep(2000); continue }
      const base = webBase()
      if (!base) { await sleep(2000); continue }
      try {
        const res = await fetch(base + '/api/events.mux', {
          headers: { accept: 'text/event-stream' },
          signal,
        })
        if (!res.ok || !res.body) throw new Error('mux connect failed: ' + res.status)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (!signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data: ')) continue
              try { handleFrame(JSON.parse(line.slice(6))) } catch (e) { log('interaction bridge frame parse error:', e && e.message) }
            }
          }
        }
      } catch (e) {
        if (!signal.aborted) log('interaction bridge mux error:', e && e.message)
      }
      await sleep(1500) // 重连退避
    }
  }
  function start() {
    if (aborter) return
    aborter = new AbortController()
    bridgeLoop(aborter.signal).catch((e) => log('interaction bridge loop crashed:', e && (e.stack || e.message)))
  }
  function stop() {
    if (aborter) { try { aborter.abort() } catch {}; aborter = null }
    clearAll()
  }

  return { start, stop, deliver }
}
