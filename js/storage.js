/* ============================================================
   storage.js · 数据存储（云端回收版）
   双通道设计：Supabase 云端优先 → 失败自动降级为本地 JSON 导出
   （参与者在任何网络环境下作答都不会丢失）

   依赖：js/lib/supabase.min.js（需在 index.html 中先于本文件加载，
         全局暴露 window.supabase.createClient）
   配置：见下方 SUPABASE_URL / SUPABASE_ANON_KEY（未配置时自动走本地通道）
   建表与权限配置步骤：见 notes/Supabase数据回收部署指南.md
   ============================================================ */

(function () {
  "use strict";

  /* ============ Supabase 云端配置 ============
     获取步骤（详见 notes/Supabase数据回收部署指南.md）：
     1. supabase.com 注册（GitHub 账号登录）→ 新建 Project，区域选 Singapore
     2. Project Settings → API 页面复制：
        - Project URL      → 填入 SUPABASE_URL（形如 https://xxxx.supabase.co）
        - anon public key  → 填入 SUPABASE_ANON_KEY（eyJ 开头的长串）
     3. 两项任一为空串时，saveRecord 自动走"本地 JSON 导出"通道，
        网站其余功能完全不受影响 —— 可先上线再补配置 */
  const SUPABASE_URL = "https://egucidiywupssbwxykol.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_5y6uCcrriUetoyNmMWUQKA_I1yJ2ult";
  const TABLE = "responses"; // 云端表名（与建表语句一致，勿随意改）

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

  /** 触发浏览器下载 JSON 文件（降级通道 / 数据副本） */
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

  /* ============ 云端提交（Supabase） ============ */

  /**
   * 提交作答记录到 Supabase responses 表。
   * 返回 Promise<boolean>：true = 云端成功；false = 需走本地降级。
   * 任何失败（未配置 / SDK 缺失 / 网络异常 / RLS 拒绝）都只返回 false，
   * 绝不抛出阻断参与者的错误。
   */
  async function saveToCloud(record) {
    // 未配置：静默走本地通道（上线前开发调试的常态）
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
    // SDK 脚本缺失（如 js/lib/supabase.min.js 未上传）：降级并提示开发者
    if (typeof window.supabase === "undefined") {
      console.warn("[storage] supabase-js 未加载（检查 js/lib/supabase.min.js），降级为本地导出");
      return false;
    }
    try {
      const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      // user_agent：设备/浏览器指纹，用于分析手机 vs 电脑作答差异
      // created_at 不传：数据库列默认 now()，以服务器时间为准
      const payload = { user_agent: navigator.userAgent, ...record };
      const { error } = await db.from(TABLE).insert(payload);
      if (error) {
        console.warn("[storage] 云端提交失败，降级为本地导出：", error.message);
        return false;
      }
      return true;
    } catch (e) {
      console.warn("[storage] 云端提交异常，降级为本地导出：", e);
      return false;
    }
  }

  /**
   * 轻提示 toast（深色玻璃拟态风格，与全站一致；2.6s 自动消失）。
   * 仅在云端提交成功时展示 —— 本地降级时浏览器自带的下载动作
   * 已经给了参与者明确反馈，无需重复提示。
   */
  function showToast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText =
      "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);" +
      "background:rgba(20,24,38,.92);color:#e8ecff;font-size:14px;" +
      "padding:10px 18px;border-radius:10px;z-index:9999;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.35);backdrop-filter:blur(6px);" +
      "transition:opacity .3s;";
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; }, 2200);
    setTimeout(() => t.remove(), 2600);
  }

  /**
   * 统一保存入口（quiz.js 的 exportBtn 调用，接口与旧版完全兼容）：
   * 云端成功 → toast 确认；任何失败 → 自动降级为本地 JSON 下载。
   */
  function saveRecord(record) {
    saveToCloud(record).then((ok) => {
      if (ok) {
        showToast("作答数据已提交，感谢参与研究！");
      } else {
        downloadRecord(record);
      }
    });
  }

  // 挂到全局，供 quiz.js 使用
  window.storage = {
    makeParticipantId,
    getParticipantId,
    nextRoundNumber,
    saveRecord,
    downloadRecord,
    saveToCloud,
  };
})();
