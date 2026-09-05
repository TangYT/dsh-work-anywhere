/**
 * wechat-channel 失败日志策略的 TDD 测试：
 *  - failurePolicy：连续失败的重试间隔 + 日志节流（首 3 次详情 → 静默 → 每 10 次摘要 → 恢复提示）
 *  - formatErrorDetail：把 fetch 错误的 cause（code/message/syscall）拼进日志
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failurePolicy, formatErrorDetail } from '../lib/wechat-channel.js'

// ---------- failurePolicy ----------

test('failurePolicy: 第 1-2 次失败输出详情且 2s 重试', () => {
  for (const n of [1, 2]) {
    const p = failurePolicy(n, n - 1)
    assert.equal(p.log, 'detail')
    assert.equal(p.delayMs, 2000)
  }
})

test('failurePolicy: 第 3 次失败输出详情并进入 30s 间隔', () => {
  const p = failurePolicy(3, 2)
  assert.equal(p.log, 'detail')
  assert.equal(p.delayMs, 30000)
})

test('failurePolicy: 第 4-9 次失败静默，保持 30s 间隔', () => {
  for (const n of [4, 5, 6, 7, 8, 9]) {
    const p = failurePolicy(n, n - 1)
    assert.equal(p.log, 'silent')
    assert.equal(p.delayMs, 30000)
  }
})

test('failurePolicy: 每 10 次失败输出一条摘要', () => {
  for (const n of [10, 20, 30]) {
    const p = failurePolicy(n, n - 1)
    assert.equal(p.log, 'tick')
    assert.equal(p.delayMs, 30000)
  }
})

test('failurePolicy: 长故障（≥5 次后恢复）输出一条恢复提示', () => {
  const p = failurePolicy(0, 17)
  assert.equal(p.log, 'recovered')
  assert.equal(p.delayMs, 0)
})

test('failurePolicy: 短暂抖动（<5 次后恢复）不输出恢复提示', () => {
  const p = failurePolicy(0, 2)
  assert.equal(p.log, 'silent')
  assert.equal(p.delayMs, 0)
})

// ---------- formatErrorDetail ----------

test('formatErrorDetail: 无 cause 时只输出 message', () => {
  assert.equal(formatErrorDetail(new Error('fetch failed')), 'fetch failed')
})

test('formatErrorDetail: 带 cause code/message/syscall 时拼接完整细节', () => {
  const e = new Error('fetch failed')
  e.cause = { code: 'ECONNRESET', message: 'read ECONNRESET', syscall: 'read' }
  const out = formatErrorDetail(e)
  assert.match(out, /fetch failed/)
  assert.match(out, /ECONNRESET/)
  assert.match(out, /syscall read/)
})

test('formatErrorDetail: cause 只有部分字段时也能输出', () => {
  const e = new Error('fetch failed')
  e.cause = { code: 'ETIMEDOUT' }
  const out = formatErrorDetail(e)
  assert.match(out, /ETIMEDOUT/)
  assert.doesNotMatch(out, /undefined/)
})
