# CLAUDE.md

@AGENTS.md

以上是本仓库对所有 Agent 的统一要求，先完整读完再动手。针对 Claude Code 补充两点：

- 开工前先运行 `bash scripts/init.sh --no-serve`，收工前运行 `make check`，并逐条过 `AGENTS.md` 的"会话退出清单"。
- 不要自己把 `features.json` 的 `state` 改成 `passing`：只能用 `bash scripts/verify-feature.sh <id>`。
