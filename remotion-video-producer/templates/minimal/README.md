# 最小工程

拷贝整个目录起新项目，然后按 `SKILL.md` 的五道门走。

## 三步

```bash
cp -r templates/minimal my-video && cd my-video
npm i
npm run dev
```

## 起项目后立刻要做的两件事

1. **放字体**：`public/fonts/` 放按「全部文案并集」生成的 woff2 子集，并在 `src/tokens.ts` 的 `FONTS` 里登记。同时写 `public/fonts/glyphs.txt`（一行，把所有用到的字连起来），否则 `assert.mjs` 无法验证字形覆盖。
2. **拷断言**：把 skill 的 `scripts/assert.mjs` 拷到项目根目录的 `scripts/`，每道门跑一次。

## 为什么模板里这么多注释

因为这个工程存在的目的就是让那三个静态陷阱（字体没加载 / 字体竞态 / 字形缺失）没有机会复发。删注释之前先想清楚。
