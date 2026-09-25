import path from "node:path";
import ejs from "ejs";

const VIEWS_DIR = path.join(import.meta.dirname, "..", "views");

/**
 * 页面渲染助手：先渲染页面片段，再套用统一布局，
 * 避免在每个页面里重复 <html> 骨架。
 */
export async function renderPage(res, view, data = {}) {
  const body = await ejs.renderFile(path.join(VIEWS_DIR, view), data);
  res.render("layout", { ...data, body });
}
