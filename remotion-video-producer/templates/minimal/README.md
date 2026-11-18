# 最小工程

拷贝整个目录起新项目，然后按 `SKILL.md` 的五道门走。

## 三步

```bash
cp -r templates/minimal my-video && cd my-video
npm i
npm run dev
```

## 起项目后立刻要做的三件事

1. **改 `src/spec.json`**：`platform` 填投放平台（决定节奏与字数阈值），`copy` 按字体登记全片全部文案。场景代码只从这里取文案。
2. **放字体**：`public/fonts/` 放按 `spec.json` 全部文案并集生成的 woff2 子集，在 `src/tokens.ts` 的 `FONTS` 里登记；`FONTS` 的键要和 `spec.json` 里 `copy` 的键一致。字形覆盖由断言直接读字体 cmap 核对，不需要手写清单。
3. **确认断言能跑**：`scripts/assert.mjs` 是转发器，会去 skill 目录找唯一那份门禁脚本。找不到时设 `VIDEO_SKILL_DIR=<skill 目录>`。G4 / G5 需要 ffmpeg（`brew install ffmpeg`，或用 Remotion 自带的）。

```bash
npm run assert:g1   # 每道门一条，g1 … g5
```

## 为什么模板里这么多注释

因为这个工程存在的目的就是让那三个静态陷阱（字体没加载 / 字体竞态 / 字形缺失）没有机会复发。删注释之前先想清楚。
