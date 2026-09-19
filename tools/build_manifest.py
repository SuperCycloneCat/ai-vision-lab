"""
build_manifest.py · 生成网站图片池与清单（幂等，补图后重跑即可）

功能：
1. 扫描 experiment/images/{real,ai}/ 下的图片
2. 抽样：每类别 × 每真伪最多 POOL_PER_CATEGORY 张（控制仓库体积）
3. 压缩：长边 resize 至 1024px，统一转 JPEG 质量 85（手机加载快）
4. 生成 website/data/manifest.js（window.QUIZ_MANIFEST，内嵌清单）
   —— 采用 .js 而非 .json：直接双击 index.html（file:// 协议）也能加载

类别从文件名解析（如 real_landscape_01 → landscape）
"""

import json
import random
import re
import shutil
from pathlib import Path

from PIL import Image

SRC = Path(r"D:\myResearch\experiment\images")
DST = Path(r"D:\myResearch\website\images")
OUT = Path(r"D:\myResearch\website\data\manifest.js")

POOL_PER_SOURCE = 30    # 每真伪抽样上限（real 30 + ai 30 = 60 张池）
MAX_SIDE = 1024         # 长边像素
JPEG_QUALITY = 85


def parse_category(stem: str, is_ai: bool) -> str:
    """从文件名解析类别；AI 动物图（ComfyUI 生成）统一归 animal"""
    if is_ai:
        return "animal"
    m = re.match(r"([a-zA-Z]+)", stem)
    prefix = m.group(1).lower() if m else "unknown"
    return {"animals": "animal"}.get(prefix, prefix)


def compress(src: Path, dst: Path):
    """resize 长边至 MAX_SIDE，统一转 JPEG"""
    with Image.open(src) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = MAX_SIDE / max(w, h)
        if scale < 1:
            im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        im.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True)


def main():
    random.seed()  # 每次随机抽样

    if DST.exists():
        shutil.rmtree(DST)

    entries = []
    for is_ai, folder in ((False, "real"), (True, "ai")):
        src_dir = SRC / folder
        if not src_dir.exists():
            print(f"[warn] 缺少目录 {src_dir}")
            continue

        files = [
            p for p in src_dir.iterdir()
            if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")
        ]
        picked = random.sample(files, min(POOL_PER_SOURCE, len(files)))
        picked.sort()  # 保证输出命名稳定

        out_dir = DST / folder
        out_dir.mkdir(parents=True, exist_ok=True)

        for i, p in enumerate(picked, start=1):
            category = parse_category(p.stem, is_ai)
            dst = out_dir / f"{'ai' if is_ai else 'real'}_{category}_{i:02d}.jpg"
            compress(p, dst)
            entries.append({
                "id": dst.stem,
                "path": f"images/{folder}/{dst.name}",
                "category": category,
                "is_ai": is_ai,
                "is_attention": False,
            })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"images": entries}, ensure_ascii=False, indent=2)
    OUT.write_text("window.QUIZ_MANIFEST = " + payload + ";\n", encoding="utf-8")

    n_ai = sum(1 for e in entries if e["is_ai"])
    size_mb = sum(f.stat().st_size for f in DST.rglob("*") if f.is_file()) / 1e6
    print(f"OK: {len(entries)} images (real {len(entries) - n_ai} / ai {n_ai}), {size_mb:.1f} MB")
    print(f"    -> {OUT}")


if __name__ == "__main__":
    main()
