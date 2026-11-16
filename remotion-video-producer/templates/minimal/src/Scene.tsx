import React from 'react';
import { AbsoluteFill, interpolate, Easing, useCurrentFrame } from 'remotion';
import { COLORS, FONTS, TYPE } from './tokens';
import { useFontsReady } from './fonts';

// 一镜一个文件。本文件不许出现色值、字号、曲线——全部来自 tokens。
// 本片全部文案的并集。任何一个字没被字体子集覆盖，渲染会直接失败。
const COPY = '在这里写文案 01 · SINGLE ORIGIN';

export const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  useFontsReady(COPY);

  const p = interpolate(frame, [0, 45], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(56% 40% at 74% 14%, rgba(${COLORS.accentRGB},${COLORS.glowAlpha}) 0%, ${COLORS.transparentWarm} 74%)`,
        }}
      />
      {/* 首帧即有信息：静态索引常驻，不参与入场（自检第 7 项） */}
      <div style={{ position: 'absolute', left: 72, top: 96 }}>
        <span style={{ fontFamily: FONTS.mono.family, fontSize: TYPE.label, letterSpacing: 7, color: COLORS.ink3 }}>
          01 · SINGLE ORIGIN
        </span>
      </div>

      <div style={{ position: 'absolute', left: 72, top: 740, opacity: p }}>
        <span style={{ fontFamily: FONTS.serif.family, fontWeight: 500, fontSize: TYPE.title, color: COLORS.ink }}>
          在这里写文案
        </span>
      </div>
    </AbsoluteFill>
  );
};
