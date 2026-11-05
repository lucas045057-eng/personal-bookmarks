# 架构

## 一句话

静态站点 + 一个健康接口。没有后端、没有数据库、没有运行时依赖。

```
index.html ──┐
             ├─ scripts/build.mjs ─► dist/ ──► GitHub Pages
version.json ┘   （含完整 commit SHA）            │
                                                  └─ https://<owner>.github.io/<仓库名>/version.json ◄── 交付流水线核对
```

## 组成

| 部分 | 说明 |
| --- | --- |
| `index.html` | 页面。启动后 `fetch("./version.json")`，把提交短 SHA 显示出来并链接到该提交。CSP 限制为"只请求本站、无外部资源"。 |
| `scripts/build.mjs` | 把 `index.html` 复制进 `dist/`，生成 `dist/version.json`：`{ok, name, repo, commit, dirty, built_at}`。`commit` 取 `GITHUB_SHA`（CI）或 `git rev-parse HEAD`。 |
| `scripts/serve.mjs` | 零依赖静态服务器，只监听 127.0.0.1，拒绝 `../` 穿越。本地预览和 e2e 共用。 |
| `scripts/e2e.mjs` | 对 `dist/` 起真服务器走访客路径；把页面内联脚本放进 `node:vm` 真执行，断言页面显示的就是 `version.json` 的提交。 |
| `scripts/features.mjs` | `features.json` 的唯一读写入口，负责 passing 的写入与复核（见下）。 |
| `scripts/lint.mjs` | 公开仓库的体检：密钥扫描、语法、交付设置、工作流、页面、功能清单。 |

## 功能清单与 passing 的约束

`features.json` 每项：`id`、`behavior`、`verification`（在仓库根目录执行、退出码 0 即通过的命令）、`state`、`issue`。
`state` 只有 `not_started` / `active` / `blocked` / `passing`。

- `passing` 只能由 `scripts/verify-feature.sh` 在验证命令退出 0 之后写入，同时写 `verified: {at, digest}`，`digest = sha256(id \n behavior \n verification)`。
- `make check` 的 `features` 一步：先核对每个 passing 项的 digest（手工改 state、或改了 behavior/verification 都对不上），再重跑它的验证命令；任何一项失败 → 失败。
- 这不是防篡改：能同时改 digest 的人可以伪造。真正的防线是"审查要点 + CI 重跑命令 + 人工验收"，digest 只是让"顺手改一下状态"这种错误当场暴露。

## 交付流水线（agent-autoloop 的 delivery 插件）

```
PR 打 deliver 标签 → 审查（只读文字差异，规则来自 main 的 AGENTS.md「审查要点」）
  → 等 check.yml 的 job "check" 绿 → 合并 → 等 ship.yml 成功 → 请求线上 version.json，核对 commit
```

- 设置只从 **main** 的 `ops/delivery.json` 读取，PR 自己改的设置本轮不生效。
- `ship.yml` 先调用 delivery Action 判断"这次要不要发布"（`internal` 里列的文档类改动不发布），再构建、上传 Pages artifact、`deploy-pages`。
- 健康接口：`health.url` 指向 `/version.json`，`field=commit`，`pattern` 提取 40 位 SHA，`require: {ok: true}`。

## 从模板创建新产品时要改的地方

1. `node scripts/set-repo.mjs <owner/name>`：改 `ops/delivery.json` 的 `repo` 和 `health.url`。
2. 覆盖 `features.json`（用 Issue 里的功能项，全部 `not_started`，不要带模板的 passing）、`PROJECT.md`、`PROGRESS.md`、`index.html` 的标题。
3. 仓库 Settings → Pages → Source 选 "GitHub Actions"。
