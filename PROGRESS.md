# PROGRESS

只写事实，每轮结束更新。一行一件事，写清楚"是什么、证据在哪"。

## 已完成

- 模板骨架：`AGENTS.md`、`CLAUDE.md`、`PROJECT.md`、`PROGRESS.md`、`QUALITY.md`、`docs/`。
- 构建与检查：`scripts/`（构建、预览、端到端、lint、功能清单）、`Makefile`（`make check`）、`tests/`。
- 工作流：`.github/workflows/check.yml`、`ship.yml`；交付设置 `ops/delivery.json`。
- 功能项 F1、F2 已由 `scripts/verify-feature.sh` 验证为 passing；在全新 git 仓库里 `make check` 全部通过（lint、单元测试、构建、端到端、passing 复核）。

## 进行中

- 推送到 `lucas045057-eng/agent-template`，验证 `check.yml` 变绿、`ship.yml` 发布 Pages、线上 `/version.json` 的 `commit` 等于推送的提交。

## 卡住

- 暂无。（Pages 需要在仓库里先启用，来源选 "GitHub Actions"：这一步由有管理权限的人/立项脚本做，不是代码问题。）
