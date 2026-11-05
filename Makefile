# 统一入口。Agent 和 CI 都只认 `make check`：它过了，才算"能提交"。
# 零依赖：只要 node（22+，推荐 24）、bash、git、make。
SHELL := /bin/bash
.DEFAULT_GOAL := check
.NOTPARALLEL:
.PHONY: init lint test build e2e features verify check serve clean

init:      ## 一键初始化（不启动预览）
	bash scripts/init.sh --no-serve

lint:      ## 密钥扫描 + 语法 + 交付设置 + 工作流 + 页面 + 功能清单格式
	node scripts/lint.mjs

test:      ## 单元测试（node:test）
	node --test tests/*.test.mjs

build:     ## 生成 dist/（index.html + version.json，含完整 commit SHA）
	node scripts/build.mjs

e2e: build ## 端到端：起真的 HTTP 服务器，按访客路径走一遍，页面脚本也真跑
	node scripts/e2e.mjs all

features:  ## 复核所有 state=passing 的功能项：重跑验证命令 + 核对 digest，任何一项失败就失败
	node scripts/features.mjs recheck

verify:    ## 验证某个功能项并写入状态：make verify F=F1
	@test -n "$(F)" || { echo "用法：make verify F=F1" >&2; exit 2; }
	bash scripts/verify-feature.sh $(F)

check: lint test build e2e features ## 提交前必须全绿；CI 跑的就是它
	@echo "make check 全部通过"

serve: build ## 本地预览 http://127.0.0.1:8080/
	node scripts/serve.mjs dist 8080

clean:
	rm -rf dist
