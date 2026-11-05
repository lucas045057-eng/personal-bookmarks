# 决定记录

只记**用户亲口定的事**和**为什么**。Agent 开工前先读，定过的不再问。新增放在最上面，格式固定。

格式：`## <日期> <一句话决定>` → `- 谁定的：` / `- 原因：` / `- 影响：`

## 2026-11-04 产品仓库默认公开，不放任何密钥或私人数据
- 谁定的：用户（任务书）
- 原因：GitHub Pages 免费方案只支持公开仓库；部署平台定为 GitHub Pages。
- 影响：`make lint` 做密钥扫描；`AGENTS.md` 把"不得出现密钥/私人标识"列为硬约束；站点必须是纯静态、无后端。

## 2026-11-04 `passing` 只能由验证脚本写入
- 谁定的：用户（任务书）
- 原因：避免 Agent 自己宣布"做完了"；CI 重跑所有 passing 项的验证命令。
- 影响：`scripts/verify-feature.sh` 是唯一入口；`features.json` 带 `verified.digest`；`make check` 复核。

## 2026-11-04 写的人和检查的人分开
- 谁定的：用户（任务书）
- 原因：Claude 施工、Codex 审查、CI 做最终判定。
- 影响：交付走 agent-autoloop 的 delivery 插件；审查要点写在 `AGENTS.md`，只从 main 读取。
