/* ============================================================
   quiz.js · 真伪大挑战问卷逻辑（Step 2）
   流程：说明卡 → 抽题网格标注 → 提交 → 仅对标注为 AI 的图逐张采集判断依据 → 结果页
   （知情同意为独立页面 js/consent.js，不阻塞游戏，状态随数据导出）
   依赖：storage.js（window.storage）、data/manifest.js（window.QUIZ_MANIFEST）
   ============================================================ */

(function () {
  "use strict";

  /* ============ 配置 ============ */
  const QUIZ_SIZE = 10;          // 每局判断题数量
  const AI_TARGET = 5;           // 目标 AI 图数量（池内不足时自动下调，用真实图补足）
  const ATTENTION_CHECK_ENABLED = false; // 改为 true：随机位置插入 1 张纯色图注意力检测

  const CLUES = [
    { id: "texture",   label: "纹理", desc: "皮肤/布料/材质细节异常" },
    { id: "lighting",  label: "光影", desc: "光源方向、阴影、反射不一致" },
    { id: "geometry",  label: "几何", desc: "透视、对称、结构错乱" },
    { id: "text",      label: "文字", desc: "图中文字、标识、招牌错误" },
    { id: "semantic",  label: "语义", desc: "物体关系、场景逻辑异常" },
    { id: "anatomy",   label: "解剖", desc: "人脸/手部/肢体结构错误" },
    { id: "intuition", label: "直觉", desc: "无明确线索，凭感觉" },
    { id: "other",     label: "其他", desc: "自填说明" },
  ];

  /* ============ 状态 ============ */
  let pool = [];            // manifest 全量图片
  let quizItems = [];       // 本局题目
  let startTime = 0;        // 本局开始时间戳
  let roundNumber = 1;      // 本局是当前参与者的第几局（多局沿用同一 ID）
  let clueIndex = 0;        // 依据弹窗当前题目下标（quizItems 内）
  let clueTargets = [];     // 需采集依据的题目下标 = 用户标注为 AI 的图
  let attentionPassed = null; // null=未启用

  /* ============ DOM ============ */
  const $ = (id) => document.getElementById(id);
  const heroCard = document.querySelector("#page-quiz .hero-card");
  const quizPlay = $("quizPlay");
  const quizGrid = $("quizGrid");
  const quizProgress = $("quizProgress");
  const submitBtn = $("submitBtn");
  const clueModal = $("clueModal");
  const clueProgress = $("clueProgress");
  const clueThumb = $("clueThumb");
  const clueOptions = $("clueOptions");
  const clueOtherText = $("clueOtherText");
  const clueHint = $("clueHint");
  const cluePrev = $("cluePrev");
  const clueNext = $("clueNext");
  const quizResult = $("quizResult");
  const ringFg = $("ringFg");
  const accuracyNum = $("accuracyNum");
  const resultSummary = $("resultSummary");
  const reviewGrid = $("reviewGrid");
  const exportBtn = $("exportBtn");
  const retryBtn = $("retryBtn");
  const backHomeBtn = $("backHomeBtn"); // 结果页：返回开始挑战页（说明卡）
  const startBtn = $("startQuizBtn");

  /* ============ 工具 ============ */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 纯色注意力图（canvas 生成，零资源依赖） */
  function solidColorDataUrl() {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#2b6cb0";
    ctx.fillRect(0, 0, 512, 512);
    return c.toDataURL("image/png");
  }

  /* ============ 抽题 ============ */
  function pickQuizItems() {
    const aiAll = shuffle(pool.filter((i) => i.is_ai && !i.is_attention));
    const realAll = shuffle(pool.filter((i) => !i.is_ai && !i.is_attention));

    const nAI = Math.min(AI_TARGET, aiAll.length);
    const nReal = QUIZ_SIZE - nAI;
    const items = aiAll
      .slice(0, nAI)
      .concat(realAll.slice(0, nReal))
      .map((img) => ({ ...img, marked: false, markedAt: null, clues: [], clueOther: "" }));

    // 注意力检测题：随机位置插入
    if (ATTENTION_CHECK_ENABLED) {
      const at = {
        id: "attention_solid",
        path: solidColorDataUrl(),
        isDataUrl: true,
        category: "attention",
        is_ai: false,
        is_attention: true,
        marked: false, markedAt: null, clues: [], clueOther: "",
      };
      items.splice(Math.floor(Math.random() * (items.length + 1)), 0, at);
    }
    return items;
  }

  /* ============ 渲染：标注网格 ============ */
  function renderGrid() {
    quizGrid.innerHTML = "";
    quizItems.forEach((item, idx) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "quiz-cell" + (item.marked ? " marked" : "");
      cell.dataset.idx = idx;

      const img = document.createElement("img");
      img.src = item.isDataUrl ? item.path : encodeURI(item.path);
      img.alt = "第 " + (idx + 1) + " 张图片";
      img.loading = "lazy";
      img.draggable = false;
      cell.appendChild(img);

      const badge = document.createElement("span");
      badge.className = "cell-badge";
      badge.textContent = "AI?";
      cell.appendChild(badge);

      cell.addEventListener("click", () => {
        item.marked = !item.marked;
        if (item.marked) item.markedAt = Date.now() - startTime;
        cell.classList.toggle("marked", item.marked);
        updateToolbar();
      });

      quizGrid.appendChild(cell);
    });
    updateToolbar();
  }

  function updateToolbar() {
    const n = quizItems.filter((i) => i.marked).length;
    quizProgress.textContent = "已标注 " + n + " / " + quizItems.length;
    // 需求：无论标注几张（含 0 张）都允许提交——未标注的图片即判为"真实照片"
    submitBtn.disabled = false;
  }

  /* ============ 依据弹窗 ============ */
  function renderClueOptions() {
    clueOptions.innerHTML = "";
    CLUES.forEach((c) => {
      const label = document.createElement("label");
      label.className = "clue-option";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = c.id;
      cb.checked = quizItems[clueIndex].clues.includes(c.id);
      cb.addEventListener("change", () => {
        if (c.id === "other") clueOtherText.hidden = !cb.checked;
        clueHint.hidden = true;
      });

      const text = document.createElement("span");
      text.innerHTML = "<b>" + c.label + "</b><i>" + c.desc + "</i>";

      label.appendChild(cb);
      label.appendChild(text);
      clueOptions.appendChild(label);
    });
  }

  function saveCurrentClues() {
    const item = quizItems[clueIndex];
    const checked = Array.from(
      clueOptions.querySelectorAll("input:checked")
    ).map((cb) => cb.value);
    item.clues = checked;
    item.clueOther = checked.includes("other") ? clueOtherText.value.trim() : "";
  }

  function openClueModal(idx) {
    clueIndex = idx;
    const item = quizItems[idx];
    const pos = clueTargets.indexOf(idx); // 当前是需采集图中的第几张

    clueProgress.textContent = "第 " + (pos + 1) + " / " + clueTargets.length + " 张";
    clueThumb.src = item.isDataUrl ? item.path : encodeURI(item.path);
    clueOtherText.hidden = !item.clues.includes("other");
    clueOtherText.value = item.clueOther;
    clueHint.hidden = true;
    renderClueOptions();

    cluePrev.disabled = pos === 0;
    clueNext.textContent = pos === clueTargets.length - 1 ? "完成" : "下一张";

    clueModal.hidden = false;
  }

  function closeClueModal() {
    clueModal.hidden = true;
  }

  function advanceClue() {
    const anyChecked = clueOptions.querySelector("input:checked");
    if (!anyChecked) {
      clueHint.hidden = false;
      return;
    }
    saveCurrentClues();

    const pos = clueTargets.indexOf(clueIndex);
    if (pos < clueTargets.length - 1) {
      openClueModal(clueTargets[pos + 1]);
    } else {
      closeClueModal();
      showResult();
    }
  }

  /* ============ 结果页 ============ */
  function buildRecord() {
    const responses = quizItems.map((it, idx) => ({
      question_index: idx + 1,
      image_id: it.id,
      marked_as_ai: !!it.marked,
      ground_truth_is_ai: !!it.is_ai,
      is_correct: !!it.marked === !!it.is_ai,
      reaction_time_ms: it.markedAt,
      clues_selected: it.clues || [],
      clue_other_text: it.clueOther || "",
      is_attention: !!it.is_attention,
    }));
    const judged = responses.filter((r) => !r.is_attention);
    return {
      // 多局识别：同一参与者（同一浏览器）所有局沿用同一 ID，round_number 区分局次
      participant_id: window.storage.getParticipantId(),
      round_number: roundNumber,
      session_start: new Date(startTime).toISOString(),
      n_questions: quizItems.length,
      // 知情同意状态：granted / denied / null（未选择）
      // 数据分析时按 consent === "granted" 筛选研究样本
      consent: window.getConsentState ? window.getConsentState() : null,
      attention_check_enabled: ATTENTION_CHECK_ENABLED,
      attention_check_passed: attentionPassed,
      responses: responses,
      overall_accuracy:
        judged.reduce((s, r) => s + (r.is_correct ? 1 : 0), 0) / judged.length,
    };
  }

  function showResult() {
    const record = buildRecord();

    // 注意力检测未通过：仍显示结果，但标记数据无效
    if (ATTENTION_CHECK_ENABLED && attentionPassed === false) {
      resultSummary.textContent =
        "注意力检测未通过，本局数据将标记为无效。感谢参与！";
    } else {
      resultSummary.textContent =
        "你识破了 " +
        Math.round(record.overall_accuracy * 100) +
        "% 的 AI 图像。点击下方按钮导出你的作答数据，交给研究者汇总。";
    }

    // 回顾网格
    reviewGrid.innerHTML = "";
    quizItems.forEach((it, idx) => {
      const ok = !!it.marked === !!it.is_ai;
      const cell = document.createElement("div");
      cell.className = "review-cell " + (ok ? "tag-ok" : "tag-err");
      const img = document.createElement("img");
      img.src = it.isDataUrl ? it.path : encodeURI(it.path);
      img.alt = "第 " + (idx + 1) + " 张";
      img.loading = "lazy";
      const tag = document.createElement("span");
      tag.textContent = ok ? "✓" : "✗";
      cell.appendChild(img);
      cell.appendChild(tag);
      reviewGrid.appendChild(cell);
    });

    // 数字滚动 + 圆环动画
    quizPlay.hidden = true;
    quizResult.hidden = false;
    const acc = record.overall_accuracy;
    const t0 = performance.now();
    (function tick(t) {
      const p = Math.min((t - t0) / 900, 1);
      accuracyNum.textContent = Math.round(acc * 100 * p);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);

    const LEN = 2 * Math.PI * 52;
    ringFg.style.strokeDasharray = LEN;
    ringFg.style.strokeDashoffset = LEN;
    requestAnimationFrame(() => {
      ringFg.style.strokeDashoffset = LEN * (1 - acc);
    });

    // 导出按钮绑定本局记录
    exportBtn.onclick = () => window.storage.saveRecord(record);
  }

  /* ============ 局控制 ============ */
  /** 返回开始挑战页（说明卡）：结束当前局面，回问卷首页 */
  function backToStart() {
    quizResult.hidden = true;
    quizPlay.hidden = true;
    heroCard.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startQuiz() {
    quizItems = pickQuizItems();
    startTime = Date.now();
    attentionPassed = null;
    roundNumber = window.storage.nextRoundNumber(); // 多局识别：第几局

    heroCard.hidden = true;
    quizResult.hidden = true;
    quizPlay.hidden = false;
    renderGrid();
    quizPlay.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ============ 初始化 ============ */
  function init() {
    pool = (window.QUIZ_MANIFEST && window.QUIZ_MANIFEST.images) || [];
    if (!pool.length) {
      quizProgress.textContent = "图片池为空：请先运行 tools/build_manifest.py";
      return;
    }

    startBtn.addEventListener("click", startQuiz);
    retryBtn.addEventListener("click", startQuiz);
    backHomeBtn.addEventListener("click", backToStart);

    submitBtn.addEventListener("click", () => {
      // 注意力判定
      if (ATTENTION_CHECK_ENABLED) {
        const at = quizItems.find((i) => i.is_attention);
        attentionPassed = at ? !at.marked : true; // 纯色图应不标注（即真实照片）
      }
      // 需求：仅对用户标注为 AI 的图片采集判断依据，未标注（判为真实照片）不弹依据框
      clueTargets = quizItems
        .map((it, idx) => (it.marked ? idx : -1))
        .filter((idx) => idx >= 0);
      if (!clueTargets.length) {
        showResult(); // 一张都没标注：跳过依据环节直接出结果
        return;
      }
      openClueModal(clueTargets[0]);
    });
    cluePrev.addEventListener("click", () => {
      saveCurrentClues();
      const pos = clueTargets.indexOf(clueIndex);
      if (pos > 0) openClueModal(clueTargets[pos - 1]);
    });
    clueNext.addEventListener("click", advanceClue);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
