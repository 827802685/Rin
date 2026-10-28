# Rin 自主迭代引擎 (auto-iter)

由 `rin_iter.py` 驱动的自主项目迭代代理，按以下规则在 `auto` 分支上持续改进代码库，
每完成 5 次成功迭代后合并到 `main`。

## 调度
- 主调度：**GitHub Actions** 定时工作流 `.github/workflows/auto-iterate.yml`，每天 **01:00 (Asia/Shanghai, 17:00 UTC)** 触发，使用仓库内置 `GITHUB_TOKEN` 推送（无需外部令牌）。
- 备选：沙箱/本机的 `cron`（每天 1:00）调用 `python3.11 iter.py`。

## 规则（严格遵守）
1. 所有改动只在 `auto` 分支；`auto` 不存在则从 `main` 创建，否则基于最新 `main` 更新。
2. 每次迭代：同步 main → 切 auto → 分析状态 → 选目标（优先级：构建失败>测试失败>bug>功能缺陷>小改进）→ 最小可验证改动 → 构建+测试 → 提交（含迭代编号/类型/摘要/构建测试结果）→ 报告。
3. 每 5 次成功迭代：合并 `auto` → `main`（合并提交，保留历史），随后 `auto` 重置到 `main`。
4. 构建产物/测试产物/日志/缓存/依赖不得入库（见 `.gitignore`）。

## 本地运行
```bash
export RIN_AUTO_TOKEN=ghp_xxx          # 仅沙箱直推时需要；Actions 用 GITHUB_TOKEN
export RIN_LOCAL=/workspace/Rin        # 本地工作副本
python3.11 iter.py                     # 执行一次迭代
python3.11 iter.py --dry               # 只分析，不提交
```
> 说明：沙箱中 `github.com:443` 对 git 智能协议被拦截，本引擎所有远端读写均走 `api.github.com`（GitHub REST API），因此可在受限网络下运行。

## 构建/测试门禁
- Build = `bun run check`（turbo 类型检查，覆盖 client/server/cli）。
- Test = 分工作区 `cd server && bun run test` 与 `cd client && bun run test`（根目录 `bun test` 已知会因 client DOM 测试误报，故不采用）。
