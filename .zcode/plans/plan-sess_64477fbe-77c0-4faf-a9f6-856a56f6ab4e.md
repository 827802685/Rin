# Live2D 及后台管理整理优化方案

## 调研结论(问题清单)

**后台管理 settings-theme.tsx(排版/功能对不上)**
1. `widget.live2d.model`(model URL)设置项完全无效:组件里读出后直接 `void modelUrl` 丢弃(live2d-widget.tsx:856-860),但设置页仍展示输入框,纯死设置。
2. 默认模型下拉用裸 `<select>` + 空 action 占位(settings-theme.tsx:504-531),与其它设置项(SearchableSelect + SettingsCardRow)风格不一致。
3. 自定义模型表单两个裸 input 长 className 完全相同(583/589 行),排版一般;且只能"删除",不能一键"设为默认"。
4. `widget.live2d.edge`(趴边模式)配置存在但设置页无 UI 入口。
5. 模型清单硬编码 4 处:live2d-widget.tsx:111(BASE_MODELS)、:697(precacheAllModels 再写一遍)、settings-theme.tsx:522-523(下拉 option)、vite.config.ts:36(AVATAR_MODEL_ORDER)。加一个模型要改 4 个文件。
6. 自定义模型 JSON 解析逻辑在 settings-theme.tsx:148-159 与 live2d-widget.tsx:125-143 重复两份。

**live2d-widget.tsx(1838 行,功能/bug)**
7. `TOOLS = ["hitokoto","photo","info"]` 传给插件但 CSS 已隐藏工具列,功能不可达(死代码)。
8. `ensureSwControl()`(654-668)是 no-op,两个分支都只是 resolve。
9. `localStorage.modelId` 写入口径不一致:switchModel 写 BASE_MODELS 全局下标(929-931),init 写命中根实际下标(1341),靠 init 重新解析兜底。
10. 表情复位疑似笔误:`model._expressionManager?.stopAllMotions?.()`(305),按 Cubism 惯例该方法在 `_motionManager` 上,表情复位永远静默失败。
11. 聊天人设硬编码芙宁娜(170-172),切到八重神子/自定义模型后聊天面板标题与人设仍是芙宁娜——功能对不上。
12. init 失败错误信息硬编码中文(1327-1337),未走 i18n;而 i18n 里 `error.load_failed`/`error.webgl` 已定义却零引用,另有 `talk.idle1/idle2` 死 key。
13. **卡顿严重**:furina 模型 moc3 约 95MB、8192 贴图,渲染分辨率跟随设备像素比,HiDPI 屏上 WebGL 片元开销翻倍。
14. client/public/libs/ 下 3 个 live2d 运行时 js 无任何引用(组件用的是远端 DIST 脚本),纯占体积。
15. sw.js catch 分支 `return cached ||...` 永远无效(能进 try 说明 cached 为 null);vite.config mp3 MIME 错标为 audio/wav、`existsSorted` 命名不实。

## 实施内容

### A. 统一模型管理(方便以后加模型)
- 新建 `client/src/components/theme/live2d/models.ts` 作为模型清单唯一来源:
  - `BUILTIN_MODELS`、`CustomModel` 类型、`parseCustomModels()`、`allModels(custom)` 合并内置+自定义、`MODEL_FILES_BY_NAME`、`resolveDefaultName()`、各模型聊天人设。
  - 该文件保持无 DOM 依赖,供 vite.config.ts 复用(替换 AVATAR_MODEL_ORDER 硬编码)。
- 设置页模型区改为一张「模型管理」卡:
  - 列出全部模型(内置标注"内置",自定义行带"设为默认"和"删除"操作),当前默认高亮。
  - 添加表单规整(名称+URL 两列/两行,统一样式),校验逻辑复用 `parseCustomModels`/公共校验函数。
  - 默认模型选择改用 SearchableSelect(与 header.layout 等一致)。
  - 移除无效的 model URL ItemInput;同步删除 `widget.live2d.model` 配置默认值(packages/config)与四语言 `theme.live2d.model.*` 文案。
  - 新增趴边模式(edge)ItemSwitch。

### B. live2d-widget.tsx 修 bug + 适度拆分
- 拆出 `live2d/models.ts`(上述)、`live2d/actions.ts`(动作引擎,ACTIONS/applyActionFrame/patchModelForActions)、`live2d/cache.ts`(pickCdnRoot/precache*/collectModelFiles/nativeFetch);组件保留挂载、拖拽、聊天、DOM 收养,预计降到 1100 行左右,行为不变。
- 修复:表情复位 `_motionManager.stopAllMotions`(带回退)、删除 `TOOLS` 与 `ensureSwControl` 死代码、统一/移除 `localStorage.modelId` 口径(实现时确认插件读取路径后择一)。
- 聊天人设跟随当前模型:内置模型各配 prompt,自定义模型用通用模板(带模型名);聊天标题显示当前模型名。
- init 失败错误信息接入 i18n(`error.load_failed` 等),删除 `talk.idle1/idle2` 死 key(四语言)。

### C. 卡顿优化(重点)
- 给 live2d 画布做 DPR 上限:实现时先读远端渲染器 chunk/index2.js 的 resize 逻辑,选最小侵入点(如 patch AppDelegate 尺寸计算或初始化期临时降 devicePixelRatio),把画布物理分辨率封顶(目标 dpr≤1.5),HiDPI 帧耗直接降一半以上。
- 设置页缩放项描述中注明:大模型(furina)较重,BCSZ1.1 为本地轻量模型;必要时把加载提示文案补充说明。
- 不动模型资源本体。

### D. 周边清理
- 删除 client/public/libs/ 下 3 个未引用 js(先全局搜索确认零引用)。
- sw.js:修死分支、简化双重否定,缓存行为不变。
- vite.config.ts:mp3 MIME 修正、`existsSorted` 改名、改用共享模型清单。
- 音乐/播放器设置区:audio JSON 加失焦校验(非法 JSON 行内提示),排版与其它区块对齐。

### E. 验证
- `bun run check`(turbo 全仓类型检查)、`cd client && bun run test`。
- `bun dev:client` 手动验证:设置页排版、模型增删/设默认/切换、live2d 加载与切换、聊天人设;卡顿改善以画布分辨率封顶生效为准。

## 不做的事
- 不做 apps/ 目录重构(遵循 AGENTS.md 重构守则)。
- 不改模型资源、不动远端 CDN 结构、不引入 renderer 包。