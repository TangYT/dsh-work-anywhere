# dsh-work-anywhere

DeepSeek Harness 标准插件：**远程实验工作区 + 微信 ClawBot 远程控制**，一个插件同时挂载两个子模块：

| 子模块 | 功能 |
| --- | --- |
| `remote-lab` | 项目 ↔ 远程服务器绑定（`.dsh-remote.json`）、回调驱动实验计划（零轮询）、SSH 执行/文件同步、每会话一次性「远程服务器速查」注入、**全局网络权限层** |
| `wechat-channel` | 微信 ClawBot（腾讯 iLink 协议）扫码绑定整个 dsh web、微信消息驱动 Agent、项目/会话查询切换、已归档会话门控、微信交互桥 |

## 网络权限层（全局，对所有会话与所有 Agent 调用生效）

在 Workspace Write 文件权限之上放行网络访问：

- **直连优先**：所有出站请求先尝试直连；
- **自动代理回退**：直连失败时自动扫描本机可用代理——环境变量（`ALL_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY`）→ Windows 系统代理（HKCU Internet Settings）→ 常见 Clash/代理端口（7890/7897/7891/7892/7898/7899/10808/10809/8888/8080、SOCKS5 1080），并行竞速、先通先用；命中代理缓存 10 分钟，过期/失效自动重扫；
- **入口**：Agent 工具 `dwa_net_fetch`（GET/POST 任意 http/https URL，上限 256KB，全会话可用、无需提升沙箱权限）；插件的飞书/企微 webhook 通知同样走该策略；
- 依赖 `undici`（HTTP CONNECT / SOCKS 代理，纯 JS）；微信 iLink 与交互桥保持回环直连。

## 安装

```bash
dsh plugin --profile web add "git+https://gitee.com/tang-yongtao/dsh-work-anywhere.git"
# 或本地链接
dsh plugin --profile web add "link:E:\dsh-work-anywhere\dsh-work-anywhere"
```

重启 dsh web 后生效。构建浏览器半（开发时）：`npm install && npm run build`。

## 远程实验（remlab_* 工具）

- 绑定：`remlab_ws_init`（服务器别名取自 dsh-ssh.json；支持密码/密钥认证、sudo 密码、含空格与 CJK 的项目目录名）
- 执行/同步：`remlab_exec` / `remlab_push` / `remlab_pull`
- 实验计划：`remlab_plan_create` / `plan_status` / `plan_update`（manual：完成时唤醒 Agent 决策；auto-chain：自动链式启动）
- 运行：`remlab_experiment_launch`（立即返回，完成由回调自动处理：状态落盘 → 产物下载 → 通知 → 唤醒 Agent）/ `stop` / `log` / `collect` / `attach`
- 诊断：`remlab_debug` / `remlab_selfcheck`
- 严格项目作用域：绑定只在项目根读取，子目录自动归属项目根，绝不跨项目继承祖先绑定
- 每会话一次性注入「远程服务器速查」：仅含该会话项目绑定的那一台服务器（不含其他主机）

## 微信远程控制（设置页「远程控制」）

- 扫码绑定（iLink 官方 Bot API），与整个 dsh web 绑定（不按项目/对话）
- 消息驱动 Agent；微信回复自动推回（长回复分条、完整无截断）

### 微信命令（仅消息开头解析）

| 命令 | 说明 |
| --- | --- |
| `/status` | 当前项目与会话（显示会话标题） |
| `/projects` | 项目列表 |
| `/switch <编号\|名称>` | 切换项目（惰性，不建空会话） |
| `/sessions` | 当前项目会话列表（已归档过滤） |
| `/session <编号\|名称\|id前缀>` | 切换会话 + 完整进度回放；`/session new` 新建会话 |
| `/go <项目> <会话>` | 跨项目直达（规则解析；单参数=当前项目内会话/项目） |
| `/help` | 帮助（插件命令 + 对话可用命令 + 可用技能） |

### 已归档会话门控（硬拒绝）

映射会话若已在 Web 端归档：普通消息**不执行**并回「⚠ 门控」提示，映射清除；`/switch` API 拒绝恢复；boot 跳过归档会话。防止操作指令在不可见会话中悄悄执行。

### 微信交互桥（审批 / 选项问答 / 计划评审）

插件扮演「无头 Web 客户端」：订阅本机 `/api/events.mux`（SSE，连接即重放全部 pending），把微信会话的交互请求转发到微信对端，并把回复经 `POST /api/respond` 交还 Web answerer——Web 界面仍显示可交互选项，微信端也能回答并推进会话：

- **审批**：微信收到「🔐 审批请求：工具 X（原因…）」，回复「允许/同意/1/y/yes」= 本次放行，其他回复 = 拒绝；10 分钟未回复自动拒绝；
- **选项问答**（`ask_user_question`）：问题 + 编号选项推送微信，回复编号/选项文本/自定义内容；多问题批次逐个问答、一次性递交；
- **计划评审**（`exit_plan_mode`）：计划全文分条推送，回复「批准」= 离开计划模式并执行，其他回复 = 继续打磨（回复内容作为反馈交回模型）；
- 非微信会话的交互帧一律忽略（Web 端行为不变）；交互等待期间，该对端的消息只交付等待器、绝不进入 Agent。

## 配置

- SSH 主机：`$DSH_HOME/dsh-ssh.json`（dsh-ssh 插件配置，支持 key/password 认证）
- 项目绑定：项目根目录 `.dsh-remote.json`（alias/remoteRoot/webhook/sudoPassword/pullPatterns）
- 微信状态：`$DSH_HOME/wechat-channel/state.json`

## 开发

```bash
npm install
npm test        # 三套离线测试：remote-lab 冒烟 / wechat 冒烟 / 全链路桥接
npm run build   # 构建浏览器半 → lib/client.js
```

支持 `cordis-plugin-hmr` 热重载（watch `lib/`）：卸载不杀会话（agent 由新实例收养）、实验 watcher 自动重挂。

## 维护备忘（事故记录，勿删）

- **核心工具在「预设层」注册**：fs/pwsh/todo/web 等工具由 agent preset 按作用域挂载。微信 create/resume 路径必须 `resolvePresetFor()` 后挂载同一预设（create 写 `meta.agentPreset`；resume 经 `sessionPersistence.inspect` 读取），否则被微信接管的会话丢失全部核心工具（"unknown tool"）。
- **HMR 重载不得杀死会话**：卸载清理**绝不** dispose agent 句柄（曾导致每次代码编辑杀死正在对话的微信会话）；新实例经 `ctx.agents.get(sid)` 收养。`while it is live` 竞态在 boot/ensureSession 两侧以「等 500ms 重试 + 已 live 收养」兜底。
- **密码认证主机必须透传**：`normalizeSshHost` 统一映射 keyPath/passphrase/password；密码只驻内存，绝不落盘。
- **项目目录名允许空格与 CJK**：`validateWsName`/`validateRemoteRoot` 仅拒绝双引号内仍具特殊含义的 `" $ \`` 与控制字符；远端命令必须用双引号包裹路径（`runWs`/`remlab_exec`），wrapper/attach 脚本用 `qsh()` 转义。
- **每会话服务器速查只注入一次**（`agent/session-start`，仅 startup/resume），且只含该会话绑定的一台服务器——改注入频率或暴露其他主机前必须经用户确认。
- 归档会话门控、`/status` 标题显示、`/session` 回放不截断（走 sendChunked 分条）等行为均有对应回归测试。

## License

MIT
