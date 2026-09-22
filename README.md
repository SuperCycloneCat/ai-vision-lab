# AI Vision Lab · 真伪大挑战

> 一个纯静态的 AI 图像认知研究平台：**「真伪大挑战」人类问卷** + **「AI 动物图检测」浏览器端模型推理**。
> 无后端、无数据库、无需服务器——全部功能在访客浏览器中完成。

**在线体验**：`https://supercyclonecat.github.io/ai-vision-lab/`（部署后填入实际地址）

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [技术架构](#技术架构)
- [目录结构](#目录结构)
- [本地运行](#本地运行)
- [检测模型说明](#检测模型说明)
- [数据与隐私](#数据与隐私)
- [开发约定（改代码必读）](#开发约定改代码必读)
- [常见问题](#常见问题)
- [图片素材说明](#图片素材说明)

---

## 项目简介

本项目是一项关于「人们如何辨别 AI 生成图像」的学术研究配套平台，包含两个相互独立的模块：

| 模块 | 面向对象 | 作用 |
|---|---|---|
| **真伪大挑战**（问卷） | 研究参与者 | 采集人类辨别 AI 图像的行为数据（10 题二选一 + 判断依据标注） |
| **AI 动物图检测**（工具） | 所有人 | 体验本项目自训练的 EfficientNet-B0 检测模型，浏览器本地推理 |

研究主文档（实验设计、文献综述、模型设计方案、执行手册）存放在项目本地的
`notes/` 文件夹中（不包含在本仓库内）。

---

## 功能特性

### 页面一：知情同意
- 独立同意页，参与者可随时返回修改选择
- 选择结果持久化到 localStorage

### 页面二：真伪大挑战（quiz）
- 每局从 60 张图片池（真实照片 30 + AI 生成 30）中抽取 **10 题**
- **点击图片 = 判断为 AI 生成**，不点击 = 判断为真实照片，可反复取消/勾选
- 提交后对「标注为 AI 的图片」逐张弹出模态框，勾选判断依据（纹理 / 光影 / 直觉等，多选 + 自定义补充）
- 结果页：正确率环形进度条、逐题回顾（真伪对照）、排行榜式总结
- **导出我的作答数据**：一键下载匿名 JSON 文件（文件名 = 参与者 ID）
- 同一参与者多局游玩复用同一 ID（localStorage），便于按人聚类分析

### 页面三：AI 动物图检测（detector）
- 上传图片（拖拽 / 点击选择），JPG / PNG / WebP，≤ 20MB
- **EfficientNet-B0 ONNX 模型在浏览器内推理**（onnxruntime-web WASM 后端），
  图片不经过任何服务器上传
- 输出二分类判定（AI 生成 / 真实照片）+ 置信度进度条与数字滚动动画
- 三态页面结构：模型未就绪占位卡 → 上传预览 → 检测结果，自动切换
- 页面打开即后台预加载模型（约 20MB），首次检测约 10~30 秒，之后秒出

---

## 技术架构

```
┌─────────────────────────── 访客浏览器 ───────────────────────────┐
│                                                                  │
│  index.html（三个 section 页面 + tab 切换）                        │
│      │                                                           │
│      ├── main.js        页面切换 / tab 指示器                     │
│      ├── consent.js     知情同意状态管理                          │
│      ├── quiz.js        问卷全流程（抽题/标注/依据/成绩/导出）      │
│      ├── detector.js    检测页状态机 + canvas 预处理 + ONNX 推理   │
│      │       │                                                   │
│      │       └── js/ort/（onnxruntime-web 1.17.0 本地化三件套）    │
│      │               ort.min.js + ort-wasm.wasm + ort-wasm-simd.wasm
│      ├── storage.js     参与者ID / 局数 / JSON 导出               │
│      └── data/manifest.js  图片池清单（window.QUIZ_MANIFEST）     │
│                                                                  │
│  models/animal_detector.onnx  ← PyTorch 训练导出（opset 17）      │
└──────────────────────────────────────────────────────────────────┘
```

- **纯静态**：可直接部署到 GitHub Pages / 任意静态托管
- **清单用 .js 而非 .json**：`file://` 双击打开也能加载图片池
- **推理引擎本地化**：onnxruntime-web 不走 CDN（避免网络不可达），随仓库分发

---

## 目录结构

```
website/
├── index.html              # 唯一入口页（三页式 SPA，tab 切换）
├── README.md               # 本文件
├── css/
│   └── style.css           # 全站样式（玻璃拟态 + 霓虹渐变风格）
├── js/
│   ├── main.js             # tab 切换 / 页面状态
│   ├── consent.js          # 知情同意逻辑
│   ├── quiz.js             # 问卷主逻辑
│   ├── detector.js         # 检测页主逻辑（含 ONNX 推理）
│   ├── storage.js          # 数据双通道：Supabase 云端回收 + 本地 JSON 导出降级
│   ├── lib/
│   │   └── supabase.min.js # supabase-js v2（本地化 UMD 构建）
│   └── ort/                # onnxruntime-web 1.17.0（本地化）
│       ├── ort.min.js      #   推理引擎 JS
│       ├── ort-wasm.wasm   #   WASM 运行时（无 SIMD 回退版）
│       └── ort-wasm-simd.wasm  # WASM 运行时（主流浏览器实际加载）
├── data/
│   └── manifest.js         # 图片池清单（tools/build_manifest.py 生成）
├── images/
│   ├── real/               # 真实照片 ×30（real_animal_01.jpg ...）
│   └── ai/                 # AI 生成图 ×30（ai_animal_01.jpg ...）
├── models/
│   └── animal_detector.onnx  # EfficientNet-B0 权重（opset 17，约 20MB）
└── tools/
    └── build_manifest.py   # 图片池构建脚本（本地运行，见下文）
```

> 注意：`tools/build_manifest.py` 中的源路径为本机绝对路径
> （`D:\myResearch\experiment\images`），仅在项目本地有意义，供研究者重建图片池使用。

---

## 本地运行

**不要直接双击 index.html**（file:// 下无法 fetch 模型，检测页会一直显示
「模型训练中」占位卡）。请通过 HTTP 服务器访问，任选其一：

```bash
# 方式 A：Python（推荐，与线上环境最接近）
cd website
python -m http.server 8765
# 浏览器打开 http://localhost:8765

# 方式 B：PyCharm
# 右键 index.html → Open in → Browser（使用内置服务器）

# 方式 C：VS Code
# 安装 Live Server 插件 → 右键 index.html → Open with Live Server
```

问卷页面双击打开可以运行（manifest.js 的设计就是兼容 file://），
但检测页必须走 HTTP。

---

## 检测模型说明

| 项目 | 内容 |
|---|---|
| 架构 | EfficientNet-B0（ImageNet 预训练 + 微调），参数量 5.3M |
| 训练数据 | `experiment/images/`：真实动物照片 148 张 + ComfyUI/Qwen-images 生成的 AI 动物图 367 张 |
| 类别索引 | 输出 logits [1,2]：索引 0 = 真实照片，1 = AI 生成 |
| 输入预处理 | RGB → 短边 256 → 中心裁剪 224 → ImageNet mean/std 归一化 → NCHW（**与训练验证管线严格一致**） |
| 导出 | `torch.onnx.export`，opset 17，固定输入 1×3×224×224 |
| 浏览器运行时 | onnxruntime-web 1.17.0，WASM 单线程（`numThreads=1`，因 GitHub Pages 无 COOP/COEP 头） |

**适用范围**：模型仅对**写实风格动物图片**训练与验证，人像 / 风景 / 卡通 / 截图等
域外图片的判定结果不可靠（页面内已向访客提示）。

**测试集性能**（分层 70/15/15 划分，固定 seed=42）：

| 指标 | 数值 |
|---|---|
| Accuracy | <!-- 训练后运行 evaluate.py 填入 --> |
| AUC | <!-- 填入 --> |
| F1 (AI 类) | <!-- 填入 --> |

> 训练 / 评估 / 导出代码位于项目本地 `experiment/detector/src/`（不在本仓库）。
> 更新模型：重新训练 → 运行 `export_onnx.py`（自动覆盖 `models/animal_detector.onnx`
> 并做 PyTorch vs ONNX 数值一致性校验）→ 提交部署。

---

## 数据与隐私

- **匿名采集**：不收集姓名、联系方式、IP；参与者 ID 为随机时间戳（`p_20260920_143025` 格式）
- **双通道保存**：点击「导出数据」时优先提交至研究者管理的 Supabase 服务（节点新加坡，
  经 HTTPS 加密传输）；提交失败自动降级为本地 JSON 文件下载，作答永不丢失
- **权限隔离**：数据库启用 RLS，匿名访问者仅可插入数据，不可读取他人作答
- **图片不出浏览器**：检测页推理全部在访客本地完成，无任何网络上传
- 知情同意页明确告知数据去向（学术研究、自愿参与、可随时退出）

作答数据 JSON 结构（供分析脚本参考）：

```json
{
  "participant_id": "p_20260920_143025",
  "round_number": 1,
  "answers": [
    {
      "image_id": "ai_animal_07",
      "is_ai": true,
      "marked_as_ai": true,
      "correct": true,
      "clues": ["texture", "lighting"]
    }
  ],
  "accuracy": 0.8,
  "timestamp": "2026-09-20T14:32:10.000Z"
}
```

---

## 开发约定（改代码必读）

| 约定 | 说明 |
|---|---|
| **缓存版本号** | 每次修改 CSS/JS 后，必须在 index.html 中递增对应引用的 `?v=N`（如 `quiz.js?v=6` → `?v=7`），否则访客拿到旧缓存 |
| **预处理一致性** | 修改 detector.js 的 `preprocess()` 前必须对照训练端 `dataset.py get_transforms(train=False)`，任何偏差都会显著降低线上精度 |
| **WASM 单线程** | `ort.env.wasm.numThreads = 1` 不可删除——静态托管无 COOP/COEP 响应头，SharedArrayBuffer 不可用 |
| **不用 CDN** | onnxruntime-web 已本地化到 `js/ort/`，不要改回 CDN 引用（部分网络环境下 CDN 不可达） |
| **重建图片池** | 修改 `tools/build_manifest.py` 的抽样数/压缩参数后本地运行 `python tools/build_manifest.py`（幂等，会清空重建 images/ 与 manifest.js） |
| **模型路径** | `models/animal_detector.onnx` 为既定路径，detector.js 靠探测该文件决定显示占位卡还是上传卡 |

---

## 常见问题

**Q：打开检测页一直显示「模型训练中」？**
页面通过 file:// 打开，或 `models/animal_detector.onnx` 缺失。用 HTTP 服务器访问即可。

**Q：点检测弹出「onnxruntime-web 脚本未加载」？**
`js/ort/` 目录三件套不完整，检查文件是否存在。

**Q：改了代码但页面没变化？**
递增 index.html 中的 `?v=N` 并强制刷新（Ctrl+F5）。

**Q：访客第一次检测很慢？**
正常——首次需下载 20MB 模型。页面打开时已后台预加载，之后同页面再测秒出。

---

## 图片素材说明

- **AI 生成图**：研究者使用本地部署的 ComfyUI + Qwen-Image 生成，无第三方版权风险
- **真实照片**：来自免版权图库来源
- 全部图片已压缩至长边 1024px、JPEG 质量 85，仅用于学术研究

---

## 许可与引用

本项目为本科生学术研究项目（数字媒体方向）。作答数据将以汇总形式呈现在研究报告中。

如需引用本研究的问卷工具或检测模型，请联系项目作者。
