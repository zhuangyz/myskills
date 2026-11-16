import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { FONTS } from './tokens';

// 三条硬规则，来自三次真实翻车：
// 1. 用 FontFace 显式注册，不用内联 <style>（消除解析时序竞态）
// 2. 必须 document.fonts.check() 断言，不通过就 cancelRender
// 3. 字形覆盖用 document.fonts.check(font, 文本) 在运行时校验——手写清单会骗人：
//    清单里写了字、字体里没有，检查照样通过，渲染出来是回退字体。

let promise: Promise<void> | null = null;

export const ensureFonts = () => {
  if (!promise) {
    const faces = Object.values(FONTS).map((f) => {
      const face = new FontFace(f.family, `url(${staticFile(f.file)}) format('woff2')`, {
        weight: f.weight,
      });
      document.fonts.add(face);
      return face.load();
    });
    promise = Promise.all(faces).then(() => undefined);
  }
  return promise;
};

// sample 必须是本片「全部文案的并集」。字体加载成功不等于字形齐全——
// 缺一个字形，那个字会单独回退，一行里混两种字体。
export const useFontsReady = (sample: string) => {
  const [handle] = useState(() => delayRender('加载字体'));
  useEffect(() => {
    ensureFonts()
      .then(() => {
        const bad: string[] = [];
        for (const f of Object.values(FONTS)) {
          if (!document.fonts.check(`${f.weight} 40px ${f.family}`)) bad.push(`${f.family} 未加载`);
          else if (!document.fonts.check(`${f.weight} 40px ${f.family}`, sample))
            bad.push(`${f.family} 字形不全`);
        }
        if (bad.length) {
          cancelRender(new Error(bad.join('；') + '。拒绝静默回退。'));
          return;
        }
        continueRender(handle);
      })
      .catch((e) => cancelRender(e as Error));
  }, [handle, sample]);
};
