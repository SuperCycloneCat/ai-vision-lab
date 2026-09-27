/* ============================================================
   storage.js · 数据存储（云端提交 + 本地下载双按钮版）
   结果页两个独立按钮，互不联动：
     - 「提交我的作答数据」→ submitRecord：只走 Supabase 云端，
       失败仅 toast 提示，不自动触发下载（由参与者自行改点下载按钮）
     - 「下载数据 (JSON)」  → downloadRecord：本地 JSON 文件下载

   依赖：js/lib/supabase.min.js（需在 index.html 中先于本文件加载，
         全局暴露 window.supabase.createClient）
   配置：见下方 SUPABASE_URL / SUPABASE_ANON_KEY（未配置时云端必然失败）
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
     3. 两项任一为空串时，submitRecord 云端必然失败（toast 提示后由参与者
        自行下载保存），网站其余功能完全不受影响 —— 可先上线再补配置 */
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

  /** 触发浏览器下载 JSON 文件（「下载数据」按钮专用，独立于云端通道） */
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
   * 云端提交的成功/失败均由此提示；本地下载按钮不提示 ——
   * 浏览器自带的下载动作已经是明确反馈。
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
   * 云端提交入口（quiz.js 结果页「提交我的作答数据」按钮调用）：
   * 只走 Supabase，失败不自动降级下载；成功/失败均有 toast 反馈。
   * 返回 Promise<boolean>：true = 已入库（quiz.js 据此锁定按钮防重复插入）；
   * false = 失败（按钮恢复可点，参与者可重试或改点「下载数据」）。
   */
  async function submitRecord(record) {
    const ok = await saveToCloud(record);
    if (ok) {
      showToast("作答数据已提交，感谢参与研究！");
    } else {
      showToast("云端提交失败，请点击「下载数据」按钮保存作答");
    }
    return ok;
  }

  // 挂到全局，供 quiz.js 使用
  window.storage = {
    makeParticipantId,
    getParticipantId,
    nextRoundNumber,
    submitRecord,
    downloadRecord,
    saveToCloud, // 底层单次云端插入（无 UI 反馈），调试用
  };
})();
