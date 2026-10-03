import path from "node:path";
import ejs from "ejs";

const VIEWS_DIR = path.join(import.meta.dirname, "..", "views");

/**
 * 页面渲染助手：先渲染页面片段，再套用统一布局，
 * 避免在每个页面里重复 <html> 骨架。
 */
export async function renderPage(res, view, data = {}) {
  // 页面片段是先于布局单独渲染的，那时 res.locals 还没参与进来，
  // 因此 CSRF 令牌必须显式透传——否则表单里的隐藏字段会渲染成空值，
  // 页面看着有令牌、实际提交必被 403（Day 7 的用例把这个坑逼了出来）。
  const body = await ejs.renderFile(path.join(VIEWS_DIR, view), {
    csrfToken: res.locals?.csrfToken ?? "",
    ...data,
  });
  res.render("layout", { wide: false, ...data, body });
}
