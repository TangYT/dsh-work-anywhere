/**
 * dsh-work-anywhere — DeepSeek Harness 标准插件（Gitee: tang-yongtao/dsh-work-anywhere）
 *
 * 组合入口：同时挂载两个子插件——
 *   - remote-lab：项目 ↔ 远程工作区绑定 + 回调驱动实验计划引擎（remlab_* 工具）
 *   - wechat-channel：微信 ClawBot（腾讯 iLink 协议）远程控制频道（dsh_wc_* 工具）
 *
 * 两个子插件各自保留独立的 ctx.effect 清理与日志前缀，热重载（HMR）安全；
 * 工具名、状态文件（~/.dsh/wechat-channel/state.json）与绑定文件（.dsh-remote.json）不变。
 */
import { inject as remlabInject, apply as remlabApply } from './remote-lab.js'
import { inject as wechatInject, apply as wechatApply } from './wechat-channel.js'

export const name = 'dsh-work-anywhere'
export const inject = [...new Set([...(remlabInject || []), ...(wechatInject || [])])]

export function apply(ctx) {
  remlabApply(ctx)
  wechatApply(ctx)
}
