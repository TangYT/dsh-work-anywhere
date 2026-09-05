# dsh-work-anywhere

<p align="center">
  <b>DeepSeek Harness 的「远程工作」插件合集</b><br/>
  远程实验工作区 · 微信远程控制 · 免沙箱审批的本地 Git 与 GitHub/HuggingFace 下载
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <a href="https://gitee.com/tang-yongtao/dsh-work-anywhere"><img alt="Gitee repo" src="https://img.shields.io/badge/Gitee-tang--yongtao%2Fdsh--work--anywhere-c71d23"></a>
  <a href="https://github.com/TangYT/dsh-work-anywhere"><img alt="GitHub repo" src="https://img.shields.io/badge/GitHub-TangYT%2Fdsh--work--anywhere-181717"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-0.4.0-green">
</p>

**dsh-work-anywhere** 是一个 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）标准插件。装上它，你能在 dsh web 里做到三件事：

1. **远程实验**：把项目绑定到远程 GPU 服务器，让 Agent 直接在服务器上跑训练/评测，结果自动下载回来；
2. **微信远程控制**：扫码把微信连上 dsh，出门在外也能查项目、切会话、推进对话，审批/问答/计划评审都能在微信里回答；
3. **本地 Git 与下载**：Agent 需要 clone、推送、下载 GitHub / HuggingFace 大文件时自动走插件内置通道，不再弹沙箱审批。

- [功能特性](#功能特性)
- [安装](#安装)
- [快速上手](#快速上手)
- [配置](#配置)
- [安全模型](#安全模型)
- [开发](#开发)
- [常见问题](#常见问题)
- [License](#license)

## 功能特性

| 模块 | 能力 | 主要场景 |
| --- | --- | --- |
| `remote-lab` | 项目 ↔ 远程服务器绑定；SSH 执行 / 文件同步；回调驱动实验计划；断线续跑；产物自动下载；飞书 / 企微 webhook 通知 | GPU 训练、长任务评测、批量实验 |
| `wechat-channel` | 微信扫码接管整个 dsh web；消息驱动 Agent；项目 / 会话切换；微信交互桥（审批、问答、计划评审可微信回复） | 通勤 / 出差时远程推进开发 |
| `local-git` + `download` | 进程内 git 全操作（HTTPS/SSH/LFS）；GitHub / HuggingFace 大文件流式下载；通用网络抓取 | AI 开发依赖 GitHub / HuggingFace 时的免审批通路 |
| `arxiv` | `dwa_arxiv_read`：链接或编号 → HTML 版论文全文纯文本（公式保留 LaTeX），秒级返回；无 HTML 的老论文自动给 PDF 下载建议 | 文献调研、读论文 |
| 网络权限层 | 直连优先，失败自动扫描本机代理回退 | 本机网络受限（需代理）的环境 |

## 安装

DSH 的插件安装只需一条命令（没有界面入口）。在命令行执行：

```bash
dsh plugin --profile web add "git+https://gitee.com/tang-yongtao/dsh-work-anywhere.git"
```

- GitHub 镜像源：把上面地址换成 `git+https://github.com/TangYT/dsh-work-anywhere.git`；
- 本地开发调试：`dsh plugin --profile web add "link:E:\dsh-work-anywhere\dsh-work-anywhere"`。

执行完成后**重启 dsh web**。打开 dsh web → 左下角「设置」→「插件」，能看到 `dsh-work-anywhere` 条目即安装成功。

## 快速上手

装好之后，以下三步全部在 dsh web 页面上完成，不需要任何命令行操作。

### ① 扫码绑定微信（可选，强烈推荐）

1. 打开 dsh web → 左下角「**设置**」→ 左侧选择「**远程控制**」；
2. 在「微信 / 飞书远程控制」卡片点击「**扫码登录**」；
3. 用微信扫描页面上的二维码，页面显示「已连接」即完成（登录态会保存，之后重启无需重扫）。

绑定后：微信里直接发消息即可查看进度、切换项目/会话、推进对话；DSH 出现审批请求、选项问答、计划评审时，也会推送到微信，直接回复就能处理。常用指令（在微信里发送，仅消息开头解析）：

| 命令 | 说明 |
| --- | --- |
| `/status` | 当前项目与会话（显示会话标题） |
| `/projects` | 项目列表 |
| `/switch <编号\|名称>` | 切换项目 |
| `/sessions` | 当前项目会话列表 |
| `/session <编号\|名称\|id前缀>` | 切换会话 + 完整进度回放；`/session new` 新建会话 |
| `/help` | 帮助 |

### ② 给每个项目绑定远程服务器

1. 先在 dsh web **侧边栏「SSH」面板**添加服务器（别名、地址、账号、密钥或密码）；
2. 打开该项目对应的对话，点击**对话标题栏的「远程实验」按钮** → 选择服务器（可选填远端目录、sudo 密码）→ 保存；
   > 也可以走：设置 →「远程控制」→「项目绑定 / 换绑」，选择项目与服务器后点击「绑定 / 换绑」；
3. 绑定完成，这个项目的对话即可让 Agent 在服务器上跑训练 / 评测 / 脚本。实验结束自动把结果下载到项目本地，还可在绑定时填写飞书 / 企微机器人地址接收完成通知。

换服务器、解绑：随时在同一个「远程实验」弹窗或设置页完成。

### ③ 其他自动生效的能力（无需任何操作）

- **本地 Git 与下载**：Agent 需要 clone / 提交 / 推送、下载 GitHub release 或 HuggingFace 模型时，自动走插件内置通道，不再弹沙箱审批。如需额外管控（push 需审批、路径限制、HF token），在设置 →「远程控制」→「网络与 Git」里按需开启；
- **arXiv 论文阅读**：Agent 拿到 arXiv 链接或编号会直接用 `dwa_arxiv_read` 读取 HTML 版全文（比 PDF 快得多、且是纯文本），无需任何操作；
- **网络代理**：直连失败自动切换本机代理，无需手动配置。

## 配置

| 文件 | 说明 |
| --- | --- |
| `$DSH_HOME/dsh-ssh.json` | SSH 主机（dsh web 侧边栏「SSH」面板配置） |
| `<项目根>/.dsh-remote.json` | 项目 ↔ 服务器绑定（由「远程实验」按钮 / 设置页生成） |
| `$DSH_HOME/wechat-channel/state.json` | 微信登录态（重启自动恢复） |
| `$DSH_HOME/work-anywhere/config.json` | Git 安全策略与 HuggingFace token（设置页「网络与 Git」维护） |
| `$DSH_HOME/work-anywhere/git-audit.jsonl` | git 全量审计日志 |

## 安全模型

- **沙箱关系**：插件不改动 DSH 的沙箱与审批策略。git 与下载在插件自身进程内执行（DSH 的受限 token 只作用于 shell 命令），因此不受 schannel 与命名管道限制；
- **纵深防御**：git 子命令白名单、危险选项拒绝、无 shell 展开；下载目标可配置为仅限项目目录；每次 git 执行写审计日志；
- **可选审批**：设置页可开启 push 审批（Web 或微信端放行）；微信端审批超时自动拒绝；
- 设置页 API 全部仅回环可访问。

## 开发

```bash
git clone https://gitee.com/tang-yongtao/dsh-work-anywhere.git
cd dsh-work-anywhere
npm install
npm test        # 7 套离线测试
npm run build   # 构建浏览器半（设置页 UI）→ lib/client.js
```

代码结构：

```
lib/
  index.js            # 组合入口（remote-lab + wechat-channel）
  remote-lab.js       # 远程实验：绑定 / SSH / 实验计划 / 回调 watcher / 工具注册
  wechat-channel.js   # 微信 ClawBot：iLink 扫码 / 消息驱动 Agent / 命令
  interactions.js     # 微信交互桥（审批 / 问答 / 计划评审转发）
  local-git.js        # 本地 git 执行器（白名单 / 策略 / 审计 / 代理重试）
  download.js         # 流式下载器（镜像回退 / 上限 / sha256）
  net.js              # 网络权限层（直连 → 代理扫描回退）
  ilink.js            # iLink 协议客户端
src/client.js         # 设置页「远程控制」+ 会话头「远程实验」按钮
test/                 # 7 套离线测试
```

### 维护者注意事项

- HMR 重载不得杀死会话：卸载清理绝不 dispose agent 句柄（新实例收养）；实验 watcher 重载后自动重挂；
- 密码认证主机必须透传（`normalizeSshHost`），密码只驻内存、绝不落盘；
- 项目目录名允许空格与 CJK：远端命令一律用双引号包裹路径；
- 每会话服务器速查只注入一次，且只含该会话绑定的一台服务器；
- 新增工具默认作用于「当前会话所在项目」；绑定只在项目根读取，绝不跨项目继承。

## 常见问题

**Q：shell 里 `git` / `curl` 报 `SEC_E_NO_CREDENTIALS` 或管道错误？**
A：正常现象（DSH 沙箱限制）。让 Agent 用插件内置通道即可，无需审批。

**Q：`huggingface.co` 直连超时？**
A：插件下载会自动回退 `hf-mirror.com` 或经本机代理；私有 / 受限模型请在设置页「网络与 Git」配置 HF token。

**Q：想给 git push 加一道审批？**
A：设置 →「远程控制」→「网络与 Git」开启「push 需审批」，审批请求可转发到微信处理。

**Q：微信里出现「⚠ 门控」？**
A：该会话已在 Web 端归档，插件拒绝在不可见会话中执行操作；请先在 Web 端取消归档。

**Q：换服务器 / 换项目绑定怎么办？**
A：对话标题栏「远程实验」按钮或设置页「项目绑定 / 换绑」重新选择即可。

## License

[MIT](LICENSE) © 2026 [tang-yongtao](https://gitee.com/tang-yongtao)
