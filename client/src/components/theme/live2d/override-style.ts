// 看板娘插件覆盖样式的构建（注入 <style id="rin-live2d-widget--override"> 的 CSS 文本）。
//
// 纯函数模块：输入 edgeRest 开关，输出与 live2d-widget.tsx 拆分前逐行等价的样式串。
// 注意：插件 waifu.css 在本样式之后加载且选择器特异性相同（都是 #waifu-tips），
// 因此气泡等属性全部带 !important（双保险），修改本文件时请保持 !important 不丢。

// 用于标记我们注入的覆盖样式元素，便于卸载时定向清理
export const OVERRIDE_STYLE_ID = "rin-live2d-widget--override";

// ---- 趴在屏幕边缘（edgeRest）模式参数 ----
// 实现思路：模型整体放大并锚定在底部中心，再用 clip-path 把下半身"裁到屏幕外"，
// 只露出上半身，配合底部一条"桌面边缘"高光，看起来像双手搭在屏幕底边。
// 因为裁的是 #live2d 画布本身，不会影响浮在上方的 #waifu-tips 气泡。
const EDGE_SCALE = 1.45; // 放大倍数
const EDGE_CLIP_TOP = "10%"; // 顶部裁掉的比例（去掉超出画面的头顶）
const EDGE_CLIP_BOTTOM = "32%"; // 底部裁掉的比例（隐藏下半身/腿）

export function buildOverrideStyleCss(edgeRest: boolean): string {
  const rules = [
    `#${OVERRIDE_STYLE_ID}{}`,
    // 模型容器：占满 React 容器，取消插件默认的 fixed 定位与过渡
    `#waifu{position:absolute !important;top:0;left:0;bottom:auto !important;`,
    `transform:none !important;transition:none !important;z-index:0 !important;`,
    `width:100%;height:100%;margin:0}`,
    `#waifu.waifu-active{bottom:auto !important}`,
    `#waifu:hover{transform:none !important}`,
    // 命中区域只留画布本体：容器/插件外壳一律不吃事件，否则正方形留白会挡住下面的
    // 点击与滚动（实测手机留白占容器 58%，用户反馈「那部分区域无法点击」）。
    // 画布自身的 pointer-events 由轮廓贴合的 clip-path 限定成人物那块矩形。
    `#waifu,#waifu-canvas{pointer-events:none}`,
    `#waifu-canvas{width:100% !important;height:100% !important;margin:0;position:relative}`,
    // 渲染门控：模型完整加载前画布透明（避免露出半成品），就绪后淡入
    `#live2d{width:100% !important;height:100% !important;position:absolute;`,
    `pointer-events:auto;touch-action:pan-y;cursor:grab;`,
    `opacity:0;transition:opacity .4s ease;}`,
    `#live2d.rin-live2d-ready{opacity:1;}`,
    // 气泡：浮在模型上方，淡蓝色半透明背景（保持透明效果，仅改颜色为淡蓝）。
    `#waifu-tips{position:absolute !important;bottom:100% !important;left:50% !important;`,
    `transform:translateX(-50%) !important;margin:0 0 8px !important;`,
    `width:max-content !important;max-width:220px !important;min-height:0 !important;`,
    `background:rgba(186,225,248,.92) !important;border:1px solid rgba(90,176,232,.45) !important;`,
    `border-radius:12px !important;box-shadow:0 4px 16px rgba(90,176,232,.28) !important;`,
    `color:#2a4a6b !important;font-size:12px !important;line-height:1.5 !important;`,
    `padding:6px 10px !important;opacity:0 !important;`,
    `transition:opacity .2s !important;z-index:20 !important;pointer-events:none !important;`,
    `text-align:center !important;`,
    `animation:none !important;overflow:visible !important;text-overflow:clip !important;`,
    `word-break:normal !important;}`,
    `[data-color-mode="dark"] #waifu-tips{background:rgba(46,84,120,.9) !important;`,
    `border-color:rgba(120,180,230,.35) !important;color:#dceaf7 !important;}`,
    `#waifu-tips.waifu-tips-active{opacity:1 !important;}`,
    `#waifu-tips span{color:#2a4a6b !important;}`,
    `[data-color-mode="dark"] #waifu-tips span{color:#dceaf7 !important;}`,
    // 工具列与开关交给 React 按钮
    `#waifu-tool,#waifu-toggle{display:none !important}`,
  ];
  // 趴在屏幕边缘：放大模型 + 裁掉下半身 + 底部画一条"桌面边缘"高光
  if (edgeRest) {
    rules.push(
      // 容器底部对齐屏幕底边，模型整体放大并锚定底部
      `#waifu{bottom:0 !important;transform:none !important;}`,
      `#live2d{transform:scale(${EDGE_SCALE});transform-origin:50% 100%;`,
      // 双写带前缀版本：iOS 13.0 及以下只认 -webkit-clip-path，缺了它下半身就露出来
      `clip-path:inset(${EDGE_CLIP_TOP} 0 ${EDGE_CLIP_BOTTOM} 0);`,
      `-webkit-clip-path:inset(${EDGE_CLIP_TOP} 0 ${EDGE_CLIP_BOTTOM} 0);}`,
      // 桌面边缘：模型下方一条细高光，模拟桌面反射/厚度
      `#waifu::after{content:"";position:absolute;left:0;right:0;bottom:0;`,
      `height:10px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,`,
      `rgba(255,255,255,.25) 40%,rgba(0,0,0,.12) 100%);`,
      `pointer-events:none;z-index:1;}`,
      `[data-color-mode="dark"] #waifu::after{`,
      `background:linear-gradient(180deg,rgba(0,0,0,0) 0%,`,
      `rgba(255,255,255,.08) 40%,rgba(0,0,0,.35) 100%);}`,
    );
    // 桌面横条视觉（比高光更明显）：画一条横贯容器底部的"桌沿"线
    rules.push(
      `#waifu::before{content:"";position:absolute;left:0;right:0;bottom:10px;`,
      `height:2px;background:rgba(120,180,230,.35);`,
      `pointer-events:none;z-index:1;}`,
    );
  }
  return rules.join("\n");
}
