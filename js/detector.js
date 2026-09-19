/* ============================================================
 * detector.js — AI 动物图检测页逻辑
 *
 * 状态机：checking → placeholder / ready → upload → preview
 *         → scanning(检测中) → result → (againBtn) → upload
 *
 * Step 4 已接通真实推理：onnxruntime-web（CDN）加载
 * models/animal_detector.onnx（EfficientNet-B0，输入 1×3×224×224，
 * 输出 logits [1,2]，索引 0=真实照片 / 1=AI 生成）。
 *
 * 网页端预处理必须与训练验证管线严格一致
 * （dataset.py get_transforms(train=False)）：
 *   RGB → 短边缩放 256 → 中心裁剪 224 → ImageNet mean/std 归一化 → NCHW
 * ============================================================ */

(function () {
  'use strict';

  // ============ 配置区 ============
  // true  = 演示模式：点击"界面演示"后用随机置信度模拟检测结果
  // false = 真实模式：调用 ONNX 模型推理（已接入）
  const DEMO_MODE = false;

  // 模型文件路径（探测成功 = 模型就绪，占位卡自动替换为上传区）
  const MODEL_URL = './models/animal_detector.onnx';

  // 上传限制
  const MAX_SIZE_MB = 20;
  const ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // 演示模式：扫描动画时长（毫秒）
  const SCAN_DURATION_MS = 2200;

  // ============ DOM 引用 ============
  const $ = (id) => document.getElementById(id);

  const els = {
    placeholder: $('modelPlaceholder'), // 状态一：模型未就绪占位
    demoBtn: $('demoBtn'),
    uploadCard: $('uploadCard'),        // 状态二：上传与预览
    dropzone: $('dropzone'),
    fileInput: $('fileInput'),
    previewWrap: $('previewWrap'),
    previewImg: $('previewImg'),
    previewName: $('previewName'),
    scanline: $('scanline'),
    detectBtn: $('detectBtn'),
    reselectBtn: $('reselectBtn'),
    result: $('detectorResult'),        // 状态三：检测结果
    demoTag: $('demoTag'),
    verdictBadge: $('verdictBadge'),
    confFill: $('confFill'),
    confNum: $('confNum'),
    againBtn: $('againBtn'),
  };

  // 当前选中的文件（File 对象 + ObjectURL）
  let currentFile = null;
  let currentObjectUrl = null;

  // ============ 工具函数 ============

  /** 显示一个元素、隐藏其余元素（三个状态块互斥） */
  function showState(name) {
    const map = {
      placeholder: els.placeholder,
      upload: els.uploadCard,
      result: els.result,
    };
    Object.entries(map).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    // 上传卡内部两个子区由 preview() / resetUpload() 单独控制
  }

  /** 格式化文件大小 */
  function formatSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  /** 校验文件类型与大小，不合法返回错误提示文本 */
  function validateFile(file) {
    if (!ACCEPT_TYPES.includes(file.type)) {
      return '不支持的图片格式，请上传 JPG / PNG / WebP 图片';
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return '图片超过 ' + MAX_SIZE_MB + 'MB，请压缩后重试';
    }
    return null;
  }

  // ============ 模型探测 ============

  /**
   * 探测 models/animal_detector.onnx 是否可访问：
   * - http(s) 下用 HEAD 请求，200 即就绪
   * - file:// 下 fetch 会失败，直接视为未就绪（走占位/演示）
   * 探测成功且非演示模式时，真实推理见下方 ONNX 推理段
   */
  async function probeModel() {
    try {
      const resp = await fetch(MODEL_URL, { method: 'HEAD' });
      return resp.ok;
    } catch (e) {
      return false; // file:// 打开或文件不存在
    }
  }

  // ============ ONNX 真实推理 ============

  let session = null; // InferenceSession 缓存：首次调用时加载模型（约 20MB），之后复用

  /**
   * 惰性创建 InferenceSession（wasm 后端）
   * - numThreads=1：GitHub Pages 无 COOP/COEP 响应头，SharedArrayBuffer
   *   不可用，多线程 WASM 会报错，必须固定单线程
   * - wasmPaths：WASM 运行时文件已本地化到 ./js/ort/（避免 CDN 不可达）
   */
  async function ensureSession() {
    if (session) return session;
    if (typeof ort === 'undefined') {
      throw new Error('onnxruntime-web 脚本未加载（js/ort/ort.min.js 缺失）');
    }
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = './js/ort/';
    session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
    });
    return session;
  }

  /**
   * 网页端预处理，严格对齐训练/验证管线（dataset.py get_transforms(train=False)）：
   *   torchvision.Resize(256)   = 短边等比缩放到 256（长边按比例）
   *   torchvision.CenterCrop(224) = 取中心 224×224
   * 分两步 canvas 绘制：先整图缩放（对应 Resize），再 1:1 像素裁剪（无二次插值），
   * 与 PIL 的两步流水线保持一致
   */
  async function preprocess(objectUrl) {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();

    // ---- 第一步：短边缩放到 256 ----
    const scale = 256 / Math.min(img.naturalWidth, img.naturalHeight);
    const rw = Math.round(img.naturalWidth * scale);
    const rh = Math.round(img.naturalHeight * scale);
    const stageCanvas = document.createElement('canvas');
    stageCanvas.width = rw;
    stageCanvas.height = rh;
    const stageCtx = stageCanvas.getContext('2d');
    stageCtx.imageSmoothingEnabled = true;
    stageCtx.imageSmoothingQuality = 'high';
    stageCtx.drawImage(img, 0, 0, rw, rh);

    // ---- 第二步：中心裁剪 224×224 ----
    const cx = Math.floor((rw - 224) / 2);
    const cy = Math.floor((rh - 224) / 2);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = 224;
    cropCanvas.height = 224;
    const cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
    cropCtx.drawImage(stageCanvas, cx, cy, 224, 224, 0, 0, 224, 224);

    // ---- 第三步：RGBA → ImageNet 归一化 → NCHW Float32 ----
    const d = cropCtx.getImageData(0, 0, 224, 224).data;
    // 与 dataset.py IMAGENET_MEAN / IMAGENET_STD 严格一致
    const MEAN = [0.485, 0.456, 0.406];
    const STD = [0.229, 0.224, 0.225];
    const HW = 224 * 224;
    const data = new Float32Array(1 * 3 * HW);
    for (let i = 0; i < HW; i++) {
      data[i]          = (d[i * 4 + 0] / 255 - MEAN[0]) / STD[0]; // R 平面
      data[HW + i]     = (d[i * 4 + 1] / 255 - MEAN[1]) / STD[1]; // G 平面
      data[2 * HW + i] = (d[i * 4 + 2] / 255 - MEAN[2]) / STD[2]; // B 平面
    }
    return new ort.Tensor('float32', data, [1, 3, 224, 224]);
  }

  /**
   * 完整推理：预处理 → session.run → softmax → 置信度
   * 输出 logits [1,2]，索引 0=真实 / 1=AI（与训练类别索引一致）
   * 返回 { isAi, confidence }，confidence 为百分数（0~100，取判定类别的概率）
   */
  async function inferImage(objectUrl) {
    const sess = await ensureSession();
    const feeds = { input: await preprocess(objectUrl) };
    const out = await sess.run(feeds);
    const logits = out.logits.data; // [1, 2] → [P(real), P(ai)] 的原始值
    // 数值稳定 softmax（先减最大值防 exp 溢出）
    const m = Math.max(logits[0], logits[1]);
    const e0 = Math.exp(logits[0] - m);
    const e1 = Math.exp(logits[1] - m);
    const pAi = e1 / (e0 + e1);
    return { isAi: pAi >= 0.5, confidence: Math.max(pAi, 1 - pAi) * 100 };
  }

  // ============ 上传交互 ============

  /** 处理用户选择的文件 → 进入预览态 */
  function handleFile(file) {
    const err = validateFile(file);
    if (err) {
      alert(err);
      return;
    }
    // 释放上一张的 ObjectURL，避免内存泄漏
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);

    currentFile = file;
    currentObjectUrl = URL.createObjectURL(file);
    els.previewImg.src = currentObjectUrl;
    els.previewName.textContent = file.name + '（' + formatSize(file.size) + '）';

    // 预览态：隐藏 dropzone、显示预览区
    els.dropzone.hidden = true;
    els.previewWrap.hidden = false;
    els.detectBtn.disabled = false;
    els.detectBtn.textContent = '开始检测';
  }

  /** 重置为初始上传态（"重新选择"/"再测一张"共用） */
  function resetUpload() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    currentFile = null;
    els.fileInput.value = '';
    els.dropzone.hidden = false;
    els.previewWrap.hidden = true;
    els.scanline.classList.remove('scanning');
    showState('upload');
  }

  // dropzone 点击 / 键盘 → 打开文件选择框
  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.fileInput.click();
    }
  });
  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files.length > 0) handleFile(els.fileInput.files[0]);
  });

  // 拖拽上传：dragover 高亮，drop 接收文件
  els.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  });
  els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('dragover');
  });
  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // ============ 检测流程 ============

  /**
   * 执行检测：
   * 演示模式 → 扫描动画 + 随机置信度（55%~97%）
   * 真实模式 → ONNX 推理（onnxruntime-web，预处理与训练一致）
   */
  function runDetection() {
    if (!currentFile) return;

    // 检测中：按钮进度态 + 扫描线动画
    els.detectBtn.disabled = true;
    els.detectBtn.textContent = '检测中…';
    els.scanline.classList.add('scanning');

    const finish = (result) => {
      els.scanline.classList.remove('scanning');
      showResult(result);
    };

    if (DEMO_MODE) {
      // ===== 演示模式：随机生成模拟结果 =====
      const confidence = 55 + Math.random() * 42; // 55 ~ 97
      const isAi = Math.random() < 0.5;           // 随机判定真/伪
      setTimeout(() => finish({ isAi, confidence }), SCAN_DURATION_MS);
    } else {
      // ===== 真实模式：ONNX 推理 =====
      // 与保底 800ms 的扫描动画并行执行，避免推理过快导致动画一闪而过
      Promise.all([
        inferImage(currentObjectUrl),
        new Promise((r) => setTimeout(r, 800)),
      ])
        .then(([result]) => finish(result))
        .catch((e) => {
          els.scanline.classList.remove('scanning');
          els.detectBtn.disabled = false;          // 恢复按钮，保留预览可重试
          els.detectBtn.textContent = '开始检测';
          alert('检测失败：' + (e && e.message ? e.message : e));
        });
    }
  }

  els.detectBtn.addEventListener('click', runDetection);
  els.reselectBtn.addEventListener('click', resetUpload);

  // ============ 结果渲染 ============

  /** 渲染结果卡片：徽章 + 置信度条动画 */
  function showResult(result) {
    const isAi = result.isAi;
    const conf = Math.round(result.confidence * 10) / 10; // 保留 1 位小数

    // 判定徽章（AI 生成 = 紫色辉光 / 真实照片 = 绿色辉光）
    els.verdictBadge.textContent = isAi ? 'AI 生成' : '真实照片';
    els.verdictBadge.className = 'verdict-badge ' + (isAi ? 'badge-ai' : 'badge-real');

    // 演示模式提示标签（Step 4 接入后自动隐藏）
    els.demoTag.hidden = !DEMO_MODE;

    // 置信度条从 0 动画增长到目标值
    els.confFill.style.width = '0%';
    els.confNum.textContent = '0.0';
    showState('result');

    // 双 requestAnimationFrame 确保过渡动画生效（从 0% → 目标宽度）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        els.confFill.style.width = conf + '%';
        // 数字滚动（与置信度条同步，约 1s）
        animateNumber(els.confNum, conf, 1000);
      });
    });
  }

  /** 数字滚动动画 */
  function animateNumber(el, target, duration) {
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      el.textContent = (target * eased).toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  els.againBtn.addEventListener('click', resetUpload);

  // ============ 占位卡"界面演示"入口 ============

  // 模型未就绪时，演示按钮直接进入上传流程（检测时用模拟数据）
  els.demoBtn.addEventListener('click', () => {
    showState('upload');
    resetUpload();
  });

  // ============ 初始化：探测模型 → 决定初始状态 ============
  probeModel().then((ready) => {
    if (ready && !DEMO_MODE) {
      // 模型就绪且非演示模式 → 直接开放上传入口（跳过占位卡）
      showState('upload');
      resetUpload();
      // 后台预加载模型（约 20MB）：用户上传图片期间即可完成加载，
      // 首次检测更快；失败不阻塞页面，点击"开始检测"时会重试并提示
      ensureSession().catch((e) => console.warn('[detector] 模型预加载失败：', e));
    } else {
      // 模型未就绪（或演示模式）→ 显示占位卡
      showState('placeholder');
    }
  });
})();
