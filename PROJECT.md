# PROJECT — agent-template

> 一页纸简报，给"秘书"和新接手的人读。从模板创建新产品时，立项脚本会改写这一页。

- **是什么**：多 Agent 长期开发的纯静态站点仓库模板。自带 Hello 页面、`make check`、CI、GitHub Pages 发布和 `version.json` 健康检查。
- **给谁用**：用户本人；产品仓库由本模板创建。
- **访问地址**：https://lucas045057-eng.github.io/agent-template/ （版本接口：`/version.json`）
- **仓库**：lucas045057-eng/agent-template（公开）
- **技术栈**：HTML/CSS/原生 JS；Node 22+ 脚本（零依赖）；GitHub Pages。
- **怎么运行**：`bash scripts/init.sh`（预览在 http://127.0.0.1:8080/）；`make check` 跑全部检查。
- **现状**：见 `PROGRESS.md`。**功能清单**：见 `features.json`（passing 才算做完）。
- **关键约束**：仓库公开，不得有任何密钥或私人数据；不引依赖；state=passing 只能由 `scripts/verify-feature.sh` 写入。
- **决定与拒绝**：`docs/decisions.md`、`docs/declined.md`。
