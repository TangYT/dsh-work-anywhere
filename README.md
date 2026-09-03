# dsh-work-anywhere

<p align="center">
  <b>DeepSeek Harness 的「远程工作」插件合集</b><br/>
  远程实验工作区 · 微信远程控制 · 免沙箱审批的本地 Git 与 GitHub/HuggingFace 下载
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <a href="https://gitee.com/tang-yongtao/dsh-work-anywhere"><img alt="Gitee repo" src="https://img.shields.io/badge/Gitee-tang--yongtao%2Fdsh--work--anywhere-c71d23"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-0.4.0-green">
</p>

**dsh-work-anywhere** 是一个 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）标准插件。它把「离开电脑也能干活」的三件事装进一个插件：

1. **远程实验**：把本地项目绑定到远程 GPU 服务器，用回调驱动的实验计划跑训练/评测，完成自动落盘、下载产物、通知并唤醒 Agent；
2. **微信远程控制**：用微信扫码接管整个 dsh web，随时查项目、切会话、推进对话，审批/问答/计划评审都能在微信里回答；
3. **本地 Git 与网络下载**：DSH 沙箱里跑不了的 git 与大文件下载，由插件在 DSH 进程内直接执行——**零审批、全会话可用**。

- [功能特性](#功能特性)
- [安装](#安装)
- [快速上手](#快速上手)
  - [远程实验](#远程实验)
  - [微信远程控制](#微信远程控制)
  - [本地 Git 与网络下载](#本地-git-与网络下载)
- [配置](#配置)
- [安全模型](#安全模型)
- [开发](#开发)
- [常见问题](#常见问题)
- [License](#license)

## 功能特性

| 模块 | 能力 | 主要场景 |
| --- | --- | --- |
| `remote-lab` | 项目 ↔ 远程服务器绑定（`.dsh-remote.json`）；SSH 执行 / 文件上传下载；回调驱动实验计划（`manual` / `auto-chain`）；断线重连与实验续挂；产物自动下载；飞书 / 企微 webhook 通知；完成时唤醒发起会话的 Agent | GPU 训练、长任务评测、批量实验 |
| `wechat-channel` | 微信 ClawBot（腾讯 iLink 协议）扫码绑定整个 dsh web；微信消息驱动 Agent 对话；项目 / 会话查询与切换；已归档会话门控；**微信交互桥**（审批、选项问答、计划评审可在微信回复） | 通勤 / 出差时远程推进开发 |
| `local-git` + `download` | `dwa_git`：进程内执行 git 全操作（HTTPS/SSH/LFS）；`dwa_net_download`：大文件流式下载（GitHub release/codeload/raw、HuggingFace 模型）；`dwa_net_fetch`：通用网络抓取 | AI 开发依赖 GitHub / HuggingFace 时的免审批通路 |
| 网络权限层 | 直连优先；失败自动扫描本机代理（环境变量 → Windows 系统代理 → 常见 Clash 端口）回退，命中缓存 10 分钟 | 本机网络受限（需代理）的环境 |

## 安装

要求 DeepSeek Harness ≥ 0.1.0。

```bash
# 从 Gitee 安装
dsh plugin --profile web add "git+https://gitee.com/tang-yongtao/dsh-work-anywhere.git"

# 或本地链接（开发调试）
dsh plugin --profile web add "link:E:\dsh-work-anywhere\dsh-work-anywhere"
```

重启 dsh web 后生效。

## 快速上手

### 远程实验

1. **配置服务器**：在 DSH 侧边栏「SSH」面板添加主机（别名 + 密钥或密码认证），配置写入 `$DSH_HOME/dsh-ssh.json`；
2. **绑定项目**：调用 `remlab_ws_init`，把当前项目绑定到一台服务器：

   ```
   remlab_ws_init(alias="A800", remoteRoot="/science/tyt/demo", sudoPassword="…")
   ```

   绑定写入项目根目录的 `.dsh-remote.json`；换服务器 = 重新调用本工具即可；
3. **创建实验计划**：

   ```
   remlab_plan_create(
     goal="训练 3 组消融实验",
     mode="manual",
     experimentsJson='[{"id":"exp1","name":"baseline","command":"bash run.sh --cfg a","cwd":"src","gpus":"0,1","timeoutSec":3600,"artifacts":["out/results.json"]}]')
   ```

4. **启动实验**：`remlab_experiment_launch`（立即返回）。实验完成时插件自动：状态落盘 → 下载产物到项目 `.remote-lab/` → webhook 通知 → 唤醒 Agent。断线也不怕——远端进程继续跑，重启后 `remlab_experiment_attach` 重新挂接；
5. **观察与收尾**：`remlab_plan_status` / `remlab_experiment_log` / `remlab_experiment_collect` / `remlab_experiment_stop`；排障用 `remlab_debug` / `remlab_selfcheck`。

> 计划模式说明：`manual` = 每个实验完成后唤醒 Agent 决策是否继续；`auto-chain` = 成功后自动启动下一个 pending 实验。

### 微信远程控制

1. 打开 dsh web 设置页「远程控制」，扫码登录微信 ClawBot（与整个 dsh web 绑定，不按项目/对话）；
2. 微信端直接发消息即可驱动当前会话的 Agent；命令（仅消息开头解析）：

| 命令 | 说明 |
| --- | --- |
| `/status` | 当前项目与会话（显示会话标题） |
| `/projects` | 项目列表 |
| `/switch <编号\|名称>` | 切换项目 |
| `/sessions` | 当前项目会话列表（已过滤归档） |
| `/session <编号\|名称\|id前缀>` | 切换会话 + 完整进度回放；`/session new` 新建会话 |
| `/go <项目> <会话>` | 跨项目直达 |
| `/help` | 帮助 |

3. **微信交互桥**：当会话出现审批请求、选项问答（`ask_user_question`）或计划评审（`exit_plan_mode`）时，插件自动把请求转发到微信，直接回复即可推进：
   - 审批：回复「允许 / 同意 / 1 / y / yes」= 本次放行，其他回复 = 拒绝；10 分钟未回复自动拒绝；
   - 选项问答：回复编号 / 选项文本 / 自定义内容；
   - 计划评审：回复「批准」= 执行计划，其他回复 = 继续打磨。
   
   非微信会话的交互不受影响（Web 端行为不变）。

### 本地 Git 与网络下载

DSH 的 Windows 沙箱（受限 token）会让 shell 里的 `git` / `curl` 因「命名管道禁用 + schannel 无凭据」失败，每次提升权限都要审批。这两个工具在 **DSH 进程内**直接执行，绕过沙箱包装、**零审批**：

```bash
# git 全部操作
dwa_git(command="clone --depth 1 https://github.com/unitreerobotics/unitree_rl_gym.git", cwd="E:/work")
dwa_git(command="push origin main", cwd="E:/work/unitree_rl_gym")

# 下载 GitHub release / 源码包
dwa_net_download(url="https://codeload.github.com/unitreerobotics/unitree_rl_gym/tar.gz/refs/heads/main", dest="E:/work/rl_gym.tar.gz")

# 下载 HuggingFace 模型文件（huggingface.co 不通时自动回退 hf-mirror.com）
dwa_net_download(url="https://huggingface.co/bert-base-uncased/resolve/main/config.json", dest="E:/work/config.json")

# 通用网络抓取（≤256KB）
dwa_net_fetch(url="https://api.github.com/repos/unitreerobotics/unitree_rl_gym")
```

- `dwa_git` 走子命令白名单 + 危险选项拒绝，**无 shell**（命令里有 `; | & < >` 会被拒绝——一次只执行一条 git 命令）；LFS 大文件默认跳过（用 `dwa_net_download` 补）；网络类失败自动带上已发现的代理重试一次；全部操作写审计日志；
- `dwa_net_download` 支持 `.part` 临时文件、大小上限（默认 10GB）、sha256 校验、自定义请求头（HuggingFace token 自动附加）；
- 可选安全策略（设置页「远程控制 → 网络与 Git」，默认关闭 = 自由使用）：**push 需审批**（审批请求可转发微信）与**路径限制**（git / 下载仅限已注册项目目录内）。

## 配置

| 文件 | 说明 |
| --- | --- |
| `$DSH_HOME/dsh-ssh.json` | SSH 主机（dsh-ssh 插件配置，密钥 / 密码认证） |
| `<项目根>/.dsh-remote.json` | 项目 ↔ 服务器绑定（alias / remoteRoot / webhook / sudoPassword / pullPatterns） |
| `$DSH_HOME/wechat-channel/state.json` | 微信登录态（重启自动恢复，无需重新扫码） |
| `$DSH_HOME/work-anywhere/config.json` | Git 安全策略（pushApproval / restrictPaths）与 HuggingFace token |
| `$DSH_HOME/work-anywhere/git-audit.jsonl` | `dwa_git` 全量审计日志 |

## 安全模型

- **沙箱关系**：插件不改动 DSH 的沙箱与审批策略。`dwa_git` / `dwa_net_download` 在插件自身的进程内执行（DSH 的受限 token 只作用于经 `ctx.sandbox` 派生的 shell 命令），因此 git / 下载不受 schannel 与命名管道限制；
- **纵深防御**：git 子命令白名单；拒绝 `--upload-pack` / `--receive-pack` / `-c core.sshCommand` 等危险项；无 shell 展开；下载 dest 可配置为仅限项目目录；
- **审计**：每次 `dwa_git` 执行写一条 JSONL 审计（时间 / 子命令 / cwd / 结果 / 是否走代理）；
- **可选审批**：设置页可开启 push 审批（走 DSH 审批流，Web 或微信端放行）；
- **交互桥 fail-closed**：微信端审批超时自动拒绝；非微信会话的交互帧一律忽略；
- 设置页 API 全部仅回环（loopback-only）可访问。

## 开发

```bash
git clone https://gitee.com/tang-yongtao/dsh-work-anywhere.git
cd dsh-work-anywhere
npm install
npm test        # 7 套离线测试：remote-lab 冒烟 / wechat 冒烟 / 交互桥 / 网络层 / git 执行器 / 下载器 / 网络下载模式
npm run build   # 构建浏览器半（设置页 UI）→ lib/client.js
```

代码结构：

```
lib/
  index.js            # 组合入口（remote-lab + wechat-channel）
  remote-lab.js       # 远程实验：绑定 / SSH / 实验计划 / 回调 watcher / 工具注册
  wechat-channel.js   # 微信 ClawBot：iLink 扫码 / 消息驱动 Agent / 命令
  interactions.js     # 微信交互桥（审批 / 问答 / 计划评审转发）
  local-git.js        # dwa_git：本地 git 执行器（白名单 / 策略 / 审计 / 代理重试）
  download.js         # dwa_net_download：流式下载器（镜像回退 / 上限 / sha256）
  net.js              # 网络权限层（直连 → 代理扫描回退）
  ilink.js            # iLink 协议客户端
src/client.js         # 设置页「远程控制」+ 会话头「远程实验」按钮
test/                 # 7 套离线测试
```

### 维护者注意事项

- **HMR 重载不得杀死会话**：卸载清理绝不 dispose agent 句柄（新实例经 `ctx.agents.get(sid)` 收养）；实验 watcher 在重载后自动重挂；
- **密码认证主机必须透传**：`normalizeSshHost` 统一映射 keyPath / passphrase / password，密码只驻内存、绝不落盘；
- **项目目录名允许空格与 CJK**：远端命令一律用双引号包裹路径，wrapper 脚本用 `qsh()` 转义；
- **每会话服务器速查只注入一次**（`agent/session-start`，仅 startup/resume），且只含该会话绑定的一台服务器；
- 新增工具默认作用于「当前会话所在项目」；绑定只在项目根读取，绝不跨项目继承祖先绑定。

## 常见问题

**Q：沙箱 shell 里 `git` / `curl` 报 `SEC_E_NO_CREDENTIALS` 或 Cygwin 管道错误？**
A：改用 `dwa_git`（git 全操作）与 `dwa_net_fetch` / `dwa_net_download`（网络），零审批。

**Q：`huggingface.co` 直连超时？**
A：`dwa_net_download` 自动回退 `hf-mirror.com`（或经本机代理）；私有 / 受限模型请在设置页配置 HF token。

**Q：`dwa_git` 拒绝我的命令？**
A：它不接受 shell 链接符（`&&`、`|`、`;` 等）与危险选项——一次调用只执行一条 git 命令，多次调用即可组合。

**Q：想给 push 加一道审批？**
A：设置页「远程控制 → 网络与 Git」开启「push 需审批」，审批请求可转发到微信处理。

**Q：微信里出现「⚠ 门控」？**
A：该会话已在 Web 端归档，插件拒绝在不可见会话中执行操作；请先在 Web 端取消归档。

## License

[MIT](LICENSE) © 2026 [tang-yongtao](https://gitee.com/tang-yongtao)
