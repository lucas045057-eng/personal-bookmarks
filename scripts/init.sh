#!/usr/bin/env bash
# 一键初始化并启动本地预览（幂等，可重复跑）。
#   bash scripts/init.sh              初始化 + 在 http://127.0.0.1:8080/ 启动预览（Ctrl-C 退出）
#   bash scripts/init.sh --no-serve   只初始化，不启动（CI / 自动化用）
#   PORT=9000 bash scripts/init.sh    换端口
# 本模板零依赖：不需要 npm install。初始化 = 检查环境 + 构建 + 校验功能清单。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVE=1
for arg in "$@"; do [ "$arg" = "--no-serve" ] && SERVE=0; done

say() { echo "[init] $*"; }
die() { echo "[init] 错误：$*" >&2; exit 1; }

command -v node >/dev/null || die "没有 node。本模板需要 Node 22 以上（推荐 24）"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || die "node 太旧：$(node -v)，需要 22 以上（推荐 24）"
command -v make >/dev/null || say "提示：没有 make，下面的 make check 用不了（apt install make 或 brew install make）"
command -v git >/dev/null || say "提示：没有 git，version.json 的 commit 会是全 0"

chmod +x scripts/*.sh 2>/dev/null || true
say "构建 dist/ 和 version.json"
node scripts/build.mjs
say "校验功能清单"
node scripts/features.mjs validate

if [ "$SERVE" = 1 ]; then
  say "启动预览（Ctrl-C 退出）"
  exec node scripts/serve.mjs dist "${PORT:-8080}"
fi
say "完成。接下来：make check"
