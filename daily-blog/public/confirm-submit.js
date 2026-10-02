/**
 * 危险操作的二次确认：把 Day 2-6 里写在标签上的 `onsubmit="return confirm(...)"`
 * 换成 `data-confirm` 属性 + 外部脚本。
 *
 * 为什么要改：Day 7 启用了严格 CSP（script-src 只允许 'self'，不放行 'unsafe-inline'），
 * 内联事件处理属性会被浏览器直接拒绝执行，删除确认会静默失效。
 * 改成属性 + 委托监听后，模板里不再有任何内联脚本。
 */
(function () {
  "use strict";

  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!form || form.tagName !== "FORM") {
        return;
      }
      var message = form.getAttribute("data-confirm");
      if (!message) {
        return;
      }
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    },
    true,
  );
})();
