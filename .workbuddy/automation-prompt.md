# Rin 博客自主迭代 —— 定时任务 prompt（更新版）

已确认调度配置（`validUntil` 已清空、状态 ACTIVE、每 12 小时）无需改动，
只需把下面**「prompt」部分**的内容替换掉旧的即可。

替换原因：旧 prompt 里基线写着「server 343 pass / 4 fail、client 61 pass」，
而实际已是 387 / 0、102 / 0；旧待办 1–6 项也全部已完成。不换会导致下次自动
运行对着过时基线误判，或重复已完成的工作。

---

继续迭代 Rin 博客源码，以「完善现有功能」为主，不要为了新增而新增。

## 环境陷阱（必读，否则会浪费大量时间）
- 仓库路径：C:\Users\Administrator\WorkBuddy\Worktrees\Rin\main-f7c3f4a1
- **bun 必须用 baseline 版**：C:\Users\Administrator\.bun\bin\bun-windows-x64-baseline\bun.exe（1.3.13）。另一个 bun-windows-x64/bun.exe 在本机会段错误，完全不可用。
- **bash 必须先执行** `export PATH="/usr/bin:/bin:$PATH"`，否则 ls/find/grep/dirname 全部 command not found。
- PowerShell 工具在本环境不返回 stdout，用 Bash。
- 源码是 **CRLF 行尾**，写正则处理文件内容时必须用 `\r?\n`，否则匹配不到。
- 不要动 bun.lock（本机镜像会把它写脏，需要时 `git checkout -- bun.lock`）。
- 不要删 .workbuddy 目录。不要 push 到远程。
- `vite build` 偶发失败于环境删除工具（genie-trash.exe 超时，发生在清空 dist 阶段），与代码无关，重试即可。
- 构建一次约 5–8 分钟，用后台任务跑，不要在前台空等。

## 验证命令（每个改动都要跑）
```
cd server      && <bun> run tsc --noEmit && <bun> test            # 387 pass / 0 fail
cd client      && <bun> run tsc --noEmit && <bun> run vitest run   # 102 pass / 0 fail
cd packages/api && <bun> test                                      # 19 pass
cd packages/ui && <bun> run typecheck
```
**基线是 0 失败**。唯一已知偶发失败是 `rss.test.ts`：沙箱访问不了
test.r2.cloudflarestorage.com 时会 5 秒超时，与代码无关，网络通时它自己会过。
**除此之外任何失败都算回归，必须查清，不许留着。**

## 已完成（不要重复，也不要撤销）
- 迁移：补 feeds.top（0011）+ rate_limits（0012）；修复 fixTopField 反向判断；
  补齐 drizzle-kit 的 meta/_journal.json 与 0012_snapshot.json（db:gen 现在能增量生成）
- 安全：密码 PBKDF2 加盐 + 恒定时间比较；/auth/login 与 /ai/chat 限流；
  OAuth state 缺失时的校验绕过；搜索 LIKE 通配符转义；CORS 不再回显任意 origin
  （新增 CORS_ORIGIN 白名单）；favicon 三处非 Error 分支返回 undefined
- 契约：@rin/api 的 parseSchema 可执行化并接入主要接口；API_PATHS 与真实路由对齐
  且有契约测试；server/tests/package-boundaries.test.ts 锁住包边界
- 功能：sitemap.xml + robots.txt；阅读进度条与字数统计；代码块复制增强；
  SiteMeta 统一前后台页面；搜索修复（% 报 500、缺 avatar、未列出文章泄露、
  管理员/访客缓存串扰）；未列出口径与 RSS/sitemap 一致；定时任务错误隔离
- 质量：i18n 四语言一致且有校验测试；useSettingsDraft 合并三个设置页状态机；
  字段样式收敛到 @rin/ui；迁移覆盖测试（schema 每列都要有迁移创建）
- 性能：路由级 lazy + monaco 组件级 lazy，首屏 gzip 1.91MB → 657KB

## 待办（按优先级，一次挑 1~2 项做完，不要贪多）
1. **客户端页面级组件测试**：102 个测试集中在 utils/hooks，页面组件几乎零覆盖。
   历史经验是「补测试 = 挖真 bug」（搜索 % 500、缓存串扰、定时任务无隔离都是
   这么发现的）。优先高频且逻辑密集的：feed_card、markdown 渲染、分页。
2. 找出下一个零覆盖的高风险模块：仿照 image-upload（279 行零覆盖）的做法，扫
   client/src/utils 与 server/src 下没有对应测试的大文件。
3. 前端 bundle 进一步优化：主包 2.08MB（gzip 657KB），markdown_editor chunk
   3.98MB 仅在编辑时加载。可考虑再拆或换轻量编辑器，先评估收益。
4. 后台 6 页（settings / settings-theme / tools-admin / health / queue-status /
   compat-tasks）仍各自写一行 Helmet title。价值低，可考虑用 SiteMeta 统一。
5. **目录重命名（apps/web、apps/worker）不要做**：AGENTS.md 明确禁止跳过前置步骤
   直接改目录名。前置「稳定边界」已由 package-boundaries 测试验证通过，但
   client/server 内部耦合仍重。是否重命名由用户决定。

## 硬性要求
- 只做能完整验证的改动，**不留半成品、不留占位代码、不写 TODO 注释了事**。
- 每个行为改动都要有测试覆盖，或明确说明为什么既有测试已覆盖。
- **写完防护类测试必须反向验证**：把修复临时撤掉，确认测试真的会变红，再恢复。
  已出现过假阳性（缓存测试因测试环境 cache.enabled 默认关闭而恒绿）。
- 验证用的临时产物（哨兵字段、临时脚本、生成的 0013 迁移）必须在同一条命令里
  清理并回显确认，不要留到「下一条命令」——曾因此把哨兵字段留在仓库里 6 天。
- `mock.module` 的路径必须与被测模块的解析结果一致；测试若在 `__tests__/` 下要
  多退一级，写错会静默失效（表现为调用次数 0）。
- UI 改动必须与现有视觉风格一致，不做大幅改版。
- 完成后用 git commit（conventional commits，中文说明），不要 push。
- 最后把做了什么、验证了什么、还剩什么，追加到 .workbuddy/memory/当天日期.md。
