/**
 * dsh-wechat-channel · iLink 客户端（腾讯微信 ClawBot 官方 Bot API）
 * 纯 HTTP/JSON，无第三方依赖。协议参考 Tencent/openclaw-weixin 官方文档
 * （"二次开发者若需对接自有后端，需实现以下接口"）。
 */
import { randomBytes, randomUUID } from 'node:crypto'

export const FIXED_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const DEFAULT_BOT_TYPE = '3'
export const STALE_TOKEN_ERRCODE = -14

const BOT_AGENT = 'DSH/0.1'
const CHANNEL_VERSION = '0.1.0'

function randomWechatUin() {
  const uint32 = randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf8').toString('base64')
}

export function buildBaseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT }
}

function buildHeaders(token) {
  const h = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`
}

/** POST JSON；成功返回解析后的 JSON（不抛业务错误，抛传输错误）。 */
export async function apiPost(baseUrl, endpoint, body, opts = {}) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl))
  const controller = opts.timeoutMs != null && opts.timeoutMs > 0 ? new AbortController() : undefined
  const t = controller != null ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined
  let signal = controller ? controller.signal : undefined
  if (signal && opts.signal) signal = AbortSignal.any([signal, opts.signal])
  else if (!signal && opts.signal) signal = opts.signal
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: buildHeaders(opts.token),
      body,
      ...(signal ? { signal } : {}),
    })
    const raw = await res.text()
    let json = null
    try { json = JSON.parse(raw) } catch {}
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`)
      err.raw = raw
      throw err
    }
    return json
  } finally {
    if (t) clearTimeout(t)
  }
}

/** GET；成功返回解析后的 JSON。 */
export async function apiGet(baseUrl, endpoint, opts = {}) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl))
  const controller = opts.timeoutMs != null && opts.timeoutMs > 0 ? new AbortController() : undefined
  const t = controller != null ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      ...(controller ? { signal: controller.signal } : {}),
    })
    const raw = await res.text()
    let json = null
    try { json = JSON.parse(raw) } catch {}
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`)
      err.raw = raw
      throw err
    }
    return json
  } finally {
    if (t) clearTimeout(t)
  }
}

/** 请求登录二维码。返回 { qrcode, qrcode_img_content }。 */
export async function fetchQrCode(botType = DEFAULT_BOT_TYPE) {
  return apiPost(
    FIXED_BASE_URL,
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    JSON.stringify({ local_token_list: [] }),
  )
}

/** 轮询一次扫码状态（长轮询至多 timeoutMs；超时/网络错误视为 wait）。 */
export async function pollQrStatus(baseUrl, qrcode, verifyCode, timeoutMs = 35000) {
  try {
    let ep = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    if (verifyCode) ep += `&verify_code=${encodeURIComponent(verifyCode)}`
    return await apiGet(baseUrl, ep, { timeoutMs })
  } catch {
    return { status: 'wait' }
  }
}

/** 长轮询收消息。客户端超时返回空结果（正常控制流）。 */
export async function getUpdates(baseUrl, token, cursor, opts = {}) {
  const timeoutMs = opts.timeoutMs || 35000
  try {
    return await apiPost(
      baseUrl,
      'ilink/bot/getupdates',
      JSON.stringify({ get_updates_buf: cursor || '', base_info: buildBaseInfo() }),
      { token, timeoutMs, signal: opts.signal },
    )
  } catch (e) {
    if (e && e.name === 'AbortError') return { ret: 0, msgs: [], get_updates_buf: cursor }
    throw e
  }
}

/** 发送文本消息（需回传最近一条入站消息的 context_token）。 */
export async function sendText(baseUrl, token, toUserId, text, contextToken) {
  const msg = {
    from_user_id: '',
    to_user_id: toUserId,
    client_id: randomUUID(),
    message_type: 2,
    message_state: 2,
    item_list: [{ type: 1, text_item: { text } }],
  }
  if (contextToken) msg.context_token = contextToken
  return apiPost(baseUrl, 'ilink/bot/sendmessage', JSON.stringify({ msg, base_info: buildBaseInfo() }), { token, timeoutMs: 15000 })
}

/** 通知微信服务端本客户端启动/停止（礼貌性，失败忽略）。 */
export async function notifyStart(baseUrl, token) {
  try {
    return await apiPost(baseUrl, 'ilink/bot/msg/notifystart', JSON.stringify({ base_info: buildBaseInfo() }), { token, timeoutMs: 10000 })
  } catch { return null }
}
export async function notifyStop(baseUrl, token) {
  try {
    return await apiPost(baseUrl, 'ilink/bot/msg/notifystop', JSON.stringify({ base_info: buildBaseInfo() }), { token, timeoutMs: 10000 })
  } catch { return null }
}
