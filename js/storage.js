/* ============================================================
   storage.js · 数据存储（Step 2）
   默认：本地 JSON 导出；预留云存储接口（Supabase，暂不启用）
   ============================================================ */

(function () {
  "use strict";

  /* ============ 预留：云存储模式（暂不启用） ============
  // 接入步骤：
  // 1. 注册 Supabase 免费层，建表 responses（字段与作答 JSON 一致）
  // 2. 取消下面注释并填入 SUPABASE_URL / SUPABASE_ANON_KEY
  // 3. 在 saveRecord 中改调 saveToCloud

  const SUPABASE_URL = "";        // 例：https://xxxx.supabase.co
  const SUPABASE_ANON_KEY = "";

  async function saveToCloud(record) {
    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error } = await db.from("responses").insert(record);
    if (error) console.warn("云存储失败，已降级为本地导出", error);
    return !error;
  }
  ============================================================ */

  /** 生成匿名参与者 ID：p_20260918_143025 */
  function makeParticipantId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      "p_" +
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      "_" +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
    );
  }

  const PID_KEY = "avl_participant_id";  // 参与者 ID 持久化键
  const ROUND_KEY = "avl_round_number";  // 局数计数键

  /**
   * 获取当前参与者 ID（多局沿用同一编号）：
   * 首次访问生成并写入 localStorage，之后所有局复用，
   * 便于数据分析时按参与者聚类（同一人 2~3 局扩观测）。
   * localStorage 不可用时退化为每局新 ID。
   */
  function getParticipantId() {
    try {
      const existing = localStorage.getItem(PID_KEY);
      if (existing) return existing;
      const id = makeParticipantId();
      localStorage.setItem(PID_KEY, id);
      return id;
    } catch (e) {
      return makeParticipantId();
    }
  }

  /**
   * 局数计数：每次开局调用，返回本轮是第几局（1 起）。
   * 用于导出数据中的 round_number 字段，识别同一参与者的多局记录。
   */
  function nextRoundNumber() {
    try {
      const n = parseInt(localStorage.getItem(ROUND_KEY) || "0", 10) + 1;
      localStorage.setItem(ROUND_KEY, String(n));
      return n;
    } catch (e) {
      return 1; // localStorage 不可用时恒为第 1 局
    }
  }

  /** 触发浏览器下载 JSON 文件 */
  function downloadRecord(record) {
    const blob = new Blob([JSON.stringify(record, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = record.participant_id + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** 统一保存入口：优先云存储，未配置/失败则降级为本地导出 */
  function saveRecord(record) {
    // 云存储启用后改为：return saveToCloud(record).then(ok => { if (!ok) downloadRecord(record); });
    downloadRecord(record);
  }

  // 挂到全局，供 quiz.js 使用
  window.storage = { makeParticipantId, getParticipantId, nextRoundNumber, saveRecord, downloadRecord };
})();
