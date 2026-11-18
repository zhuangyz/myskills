import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { FONTS } from './tokens';

// 两条运行时硬规则，来自真实翻车：
// 1. 用 FontFace 显式注册，不用内联 <style> / @font-face（消除解析时序竞态）
// 2. 加载后断言：face.status === 'loaded' 且 document.fonts.check() 通过，否则 cancelRender
//
// 字形覆盖不在这里查：document.fonts.check(font, text) 不读 cmap，
// 没声明 unicode-range 的字体被当成覆盖全部字符，缺字也返回 true。
// 覆盖由 assert.mjs 在构建期直接读字体文件的 cmap，对照 spec.json 的全部文案检查。

let promise: Promise<FontFace[]> | null = null;

export const ensureFonts = () => {
  if (!promise) {
    promise = Promise.all(
      Object.values(FONTS).map((f) => {
        const face = new FontFace(f.family, `url(${staticFile(f.file)}) format('woff2')`, { weight: f.weight });
        document.fonts.add(face);
        return face.load();
      }),
    );
  }
  return promise;
};

export const useFontsReady = () => {
  const [handle] = useState(() => delayRender('加载字体'));
  useEffect(() => {
    ensureFonts()
      .then((faces) => {
        const bad: string[] = [];
        faces.forEach((face) => {
          if (face.status !== 'loaded') bad.push(`${face.family} 状态 ${face.status}`);
        });
        for (const f of Object.values(FONTS)) {
          if (!document.fonts.check(`${f.weight} 40px "${f.family}"`)) bad.push(`${f.family} 未加载`);
        }
        if (bad.length) {
          cancelRender(new Error(bad.join('；') + '。拒绝静默回退。'));
          return;
        }
        continueRender(handle);
      })
      .catch((e) => cancelRender(e as Error));
  }, [handle]);
};
