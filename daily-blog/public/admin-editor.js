/**
 * 后台编辑页交互：Markdown 实时预览（服务端渲染，保证与前台一致）+ Ctrl/Cmd+S 保存。
 * 无构建步骤，直接作为静态资源加载。
 */
(function () {
  "use strict";

  var form = document.querySelector("[data-editor-form]");
  var input = document.querySelector("[data-editor-input]");
  var preview = document.querySelector("[data-editor-preview]");
  var endpoint = preview && preview.getAttribute("data-preview-endpoint");

  if (!form || !input || !preview || !endpoint) {
    return;
  }

  var timer = null;
  var sequence = 0;
  var PREVIEW_DELAY_MS = 400;

  function showMessage(text) {
    var paragraph = document.createElement("p");
    paragraph.className = "muted";
    paragraph.textContent = text;
    preview.replaceChildren(paragraph);
  }

  function renderPreview() {
    var current = ++sequence;
    var body = new URLSearchParams();
    body.set("content", input.value);

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      credentials: "same-origin",
    })
      .then(function (response) {
        if (response.status === 401) {
          throw new Error("登录状态已失效，请重新登录后刷新页面");
        }
        if (!response.ok) {
          throw new Error("服务端返回 " + response.status);
        }
        return response.json();
      })
      .then(function (payload) {
        // 丢弃过期响应，避免快速输入时旧结果覆盖新结果。
        if (current !== sequence) {
          return;
        }
        if (!payload.html || !payload.html.trim()) {
          showMessage("（正文为空）");
          return;
        }
        preview.innerHTML = payload.html;
      })
      .catch(function (error) {
        if (current !== sequence) {
          return;
        }
        showMessage("预览失败：" + error.message);
      });
  }

  function schedulePreview() {
    window.clearTimeout(timer);
    timer = window.setTimeout(renderPreview, PREVIEW_DELAY_MS);
  }

  input.addEventListener("input", schedulePreview);

  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "s") {
      event.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.submit();
    }
  });

  renderPreview();
})();
