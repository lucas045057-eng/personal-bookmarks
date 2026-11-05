# AGENTS.md — 先读这个

这是"多 Agent 长期开发"的仓库模板。每个 Agent（Claude、Codex……）每一轮开工都**从这里重新读起**，不依赖会话记忆：仓库是唯一的事实来源。

## 目的

用最小的纯静态站点，把整条链路钉死：改代码 → `make check` → PR → 审查 → CI → 合并 → GitHub Pages 发布 → 线上 `version.json` 核对提交。从本模板创建的新产品继承同一套纪律。

## 技术栈

- 纯静态前端：一个 `index.html`（原生 HTML/CSS/JS，无框架，无外部资源）。
- 构建与脚本：Node 22+（推荐 24）的 `.mjs`，**零依赖，不 `npm install`**；Shell 只用 bash。
- 发布：GitHub Pages（官方 Action）。仓库是**公开**的（Pages 免费版要求）。

## 首次运行

```bash
bash scripts/init.sh --no-serve   # 检查环境 + 构建 + 校验功能清单（幂等）
make check                        # 全绿才算环境正常
bash scripts/init.sh              # 想看页面：构建并在 http://127.0.0.1:8080/ 预览
```

## 目录地图

| 路径 | 作用 |
| --- | --- |
| `index.html` | 站点首页（Hello 页面，读 `version.json` 显示当前提交） |
| `features.json` | 功能清单：每项有 `id`、`behavior`、`verification`、`state`、`issue` |
| `PROJECT.md` / `PROGRESS.md` / `QUALITY.md` | 简报（秘书读）/ 进度 / 质量评分 |
| `docs/architecture.md` `decisions.md` `declined.md` | 架构 / 用户亲口定的决定 / 用户拒绝过的事 |
| `scripts/` | `init.sh` `build.mjs` `serve.mjs` `e2e.mjs` `lint.mjs` `features.mjs` `verify-feature.sh` `set-repo.mjs` |
| `tests/` | 单元测试（`node --test`） |
| `ops/delivery.json` | 交付流水线设置（审查、CI、发布、健康检查） |
| `.github/workflows/` | `check.yml`（PR/push 跑 `make check`）、`ship.yml`（main 推送后发布） |

## 工作方式

1. 先读 `PROJECT.md`、`PROGRESS.md`、`features.json`、`docs/decisions.md`、`docs/declined.md`；定过的事不再问，拒绝过的事不再提。
2. **每一轮只做一个功能项**：从 `features.json` 选一个 `not_started`/`active` 的，在**独立分支**上做，不直接推 `main`。
3. 做完跑 `bash scripts/verify-feature.sh <id>`，再跑 `make check`，开 PR 并打 `deliver` 标签；交付由 agent-autoloop 的 delivery 插件接手。
4. 用户在卡片上亲口定的事，写进 `docs/decisions.md`；他拒绝的，写进 `docs/declined.md`。

## 硬约束

- **绝不手工把 `state` 改成 `passing`**。`passing` 只能由 `scripts/verify-feature.sh` 在验证命令真的退出 0 之后写入（它同时写 `verified.digest`）。改了 `behavior` 或 `verification` 之后，旧的 passing 立刻失效，必须重新 verify。CI 会重跑所有 passing 项的验证命令并核对 digest。其它状态用 `node scripts/features.mjs set-state <id> <状态>`。
- **仓库是公开的**：不得出现任何密钥、令牌、私钥、飞书/账号标识、内网地址、私人数据。`make lint` 会扫，但不能只靠它。
- **不引入依赖**：不加 `package.json` 依赖、不引外部 CDN/字体/脚本。站点必须能离线打开。
- 不改 `.github/workflows/`、`ops/delivery.json`、`scripts/features.mjs`、`scripts/verify-feature.sh`，除非本轮功能项明确要求，并在 PR 说明里写清楚原因（这些路径会被高强度审查）。
- `index.html` 里读取版本必须用相对路径 `./version.json`（Pages 项目站点在 `/<仓库名>/` 下）。
- 第三方 Action 必须钉到 40 位提交 SHA，不用 `@v4` 这类浮动标签。
- 改动要小而完整；不顺手重构无关代码，不留调试输出和注释掉的代码。

## 验证命令

| 命令 | 做什么 |
| --- | --- |
| `make check` | 提交前必须全绿 = `lint` + `test` + `build` + `e2e` + `features` |
| `make lint` | 密钥扫描、语法、交付设置、工作流、页面、功能清单格式 |
| `make test` | 单元测试 |
| `make build` | 生成 `dist/`（含 `version.json`） |
| `make e2e` | 起真实 HTTP 服务器走一遍；页面脚本在 `vm` 里真执行 |
| `make features` | 复核所有 passing 项（重跑验证命令 + 核对 digest） |
| `make verify F=F1` | 验证单个功能项并写入状态 |

## 审查要点

交付流水线的审查只读 PR 自己的文字差异，只报告会导致结果错误、数据损失、权限或发布事故的问题。重点看：

- `features.json`：有没有手工改成 `passing`（没有对应的 `verified`）；`behavior`/`verification` 被改弱（例如换成恒成功的命令、删掉断言、范围缩小）；功能项被悄悄删除。
- 密钥与隐私：差异里出现令牌、私钥、账号标识、内网地址、私人数据，或把它们写进日志/页面。
- 工作流与发布：`.github/workflows/` 里 `permissions` 被放宽、第三方 Action 没钉 40 位 SHA、`ship.yml` 不再只在 `main` 推送时运行、发布前少了构建/版本核对；`ops/delivery.json` 的 `health.url`、`field`、`pattern` 被改动导致无法核对线上版本。
- `version.json`：`commit` 不再是完整 40 位 SHA，或不再等于构建所用的提交。
- 外部资源：页面引入了外部脚本/样式/字体/图片，或放宽了 `index.html` 的 CSP。
- `scripts/` 与 Makefile：让 `make check` 更容易通过却没有更严格的改动（跳过步骤、吞掉退出码、把失败改成警告）。
- 路径穿越、命令注入：`serve.mjs` 对 `../` 的防护、`features.mjs` 执行命令的方式被削弱。
- 范围：一个 PR 夹带了与所做功能项无关的改动。

## 会话退出清单

结束一轮之前逐条自检，缺一条就不要说"做完了"：

- [ ] **构建通过**：`make build` 成功，`dist/version.json` 的 `commit` 是完整 40 位 SHA。
- [ ] **测试通过**：`make check` 全绿（含 lint、单元测试、端到端、passing 项复核）。
- [ ] **功能清单和进度已更新**：本轮功能项已 `verify-feature.sh`（或如实标 `active`/`blocked`）；`PROGRESS.md` 写了已完成/进行中/卡住；`PROJECT.md` 在需要时更新。
- [ ] **无调试残留**：没有 `console.log`、`debugger`、临时文件、注释掉的代码、`dist/` 被提交。
- [ ] **`bash scripts/init.sh` 能一键启动**：全新克隆下运行不报错、能打开页面。
- [ ] 分支已推送、PR 已开并打 `deliver` 标签；PR 说明写了做了什么、怎么验证的。
