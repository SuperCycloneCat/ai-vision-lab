/* ============================================================
   consent.js · 知情同意状态管理
   - 同意与否都不影响游戏体验，仅作为数据标记
   - 选择存入 localStorage，可随时回本页修改
   - 状态写入导出数据：granted（同意）/ denied（不同意）/ null（未选择）
   - 数据分析时请按 consent === "granted" 筛选研究样本
   ============================================================ */

(function () {
  "use strict";

  const KEY = "avl_consent_state"; // localStorage 键名

  const $ = (id) => document.getElementById(id);
  const statusEl = $("consentStatus");
  const agreeBtn = $("consentAgreeBtn");
  const denyBtn = $("consentDenyBtn");

  /** 读取当前选择：granted / denied / null（未选择） */
  function getState() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null; // localStorage 不可用（如极端隐私模式）
    }
  }

  /** 保存选择并刷新界面 */
  function setState(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (e) { /* 保存失败时仅本次会话内生效 */ }
    render();
  }

  /** 渲染状态行 + 按钮选中高亮 */
  function render() {
    const s = getState();
    agreeBtn.classList.remove("chosen");
    denyBtn.classList.remove("chosen");

    if (s === "granted") {
      statusEl.innerHTML = "当前选择：<b>已同意参与研究</b>，感谢你的支持！";
      agreeBtn.classList.add("chosen");
    } else if (s === "denied") {
      statusEl.innerHTML = "当前选择：<b>暂不参与研究</b>，仍可正常体验游戏。";
      denyBtn.classList.add("chosen");
    } else {
      statusEl.innerHTML = "当前选择：<b>尚未选择</b>（不影响游戏体验）";
    }
  }

  agreeBtn.addEventListener("click", () => setState("granted"));
  denyBtn.addEventListener("click", () => setState("denied"));

  // 初始化渲染
  render();

  // 供 quiz.js 在导出数据时读取同意状态
  window.getConsentState = getState;
})();
