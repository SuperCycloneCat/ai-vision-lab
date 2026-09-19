/* ============================================================
   main.js · 导航切换 + 滑动指示条（Step 1）
   Step 2 的问卷逻辑放 quiz.js，Step 3/4 检测逻辑放 detector.js
   ============================================================ */

(function () {
  "use strict";

  const tabButtons = document.querySelectorAll(".tab-btn");
  const pages = {
    consent: document.getElementById("page-consent"),
    quiz: document.getElementById("page-quiz"),
    detector: document.getElementById("page-detector"),
  };
  const indicator = document.getElementById("tabIndicator");
  const TAB_NAMES = Object.keys(pages);

  /** 移动指示条到指定按钮下方 */
  function moveIndicator(btn) {
    if (!btn || !indicator) return;
    indicator.style.left = btn.offsetLeft + "px";
    indicator.style.width = btn.offsetWidth + "px";
  }

  /** 切换到指定 tab（quiz / detector），同步 hash 与指示条 */
  function activateTab(name) {
    if (!pages[name]) name = "quiz";

    tabButtons.forEach((btn) => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle("active", active);
      if (active) moveIndicator(btn);
    });

    Object.entries(pages).forEach(([key, el]) => {
      el.classList.toggle("active", key === name);
    });

    // 更新地址栏 hash（不触发额外滚动），刷新后可保持当前页面
    if (location.hash !== "#" + name) {
      history.replaceState(null, "", "#" + name);
    }
  }

  // 绑定 tab 点击
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // 点击 Logo 回到问卷页
  const logo = document.querySelector(".logo");
  if (logo) {
    logo.addEventListener("click", (e) => {
      e.preventDefault();
      activateTab("quiz");
    });
  }

  // 监听浏览器前进/后退（hash 变化）
  window.addEventListener("hashchange", () => {
    activateTab(location.hash.slice(1));
  });

  // 窗口尺寸变化时重算指示条位置
  window.addEventListener("resize", () => {
    const activeBtn = document.querySelector(".tab-btn.active");
    moveIndicator(activeBtn);
  });

  // 初始化：按 hash 决定首屏页面，无 hash 默认问卷页
  activateTab(location.hash.slice(1) || "quiz");
})();
