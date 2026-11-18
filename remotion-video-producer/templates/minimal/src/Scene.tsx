import React from 'react';
import { AbsoluteFill, interpolate, Easing, useCurrentFrame } from 'remotion';
import { COLORS, FONTS, MOTION, TYPE } from './tokens';
import { useFontsReady } from './fonts';
import spec from './spec.json';

// 一镜一个文件。本文件不许出现色值、字号、字体名、曲线——全部来自 tokens。
// 文案只从 spec.json 取：assert.mjs 用同一份文案读字体 cmap 查字形覆盖，
// 在这里直接写的中文会被判 FAIL（它绕过了字形检查）。
const [TITLE] = spec.copy.serif;
const [LABEL] = spec.copy.mono;

export const Scene: React.FC = () => {
  const frame = useCurrentFrame();
  useFontsReady();

  const p = interpolate(frame, [0, 45], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(...MOTION.curve),
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
          {LABEL}
        </span>
      </div>

      <div style={{ position: 'absolute', left: 72, top: 740, opacity: p }}>
        <span style={{ fontFamily: FONTS.serif.family, fontWeight: 500, fontSize: TYPE.title, color: COLORS.ink }}>
          {TITLE}
        </span>
      </div>
    </AbsoluteFill>
  );
};
