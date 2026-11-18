import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Scene } from './Scene';
import { CANVAS, COLORS } from './tokens';

// 时间轴必须与 storyboard.md 一一对应。
// 切点由 assert.mjs 在成片上检测，这里用 Sequence / Series / TransitionSeries、字面量或变量都可以。
export const PromoVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
    <Sequence from={0} durationInFrames={CANVAS.durationInFrames}>
      <Scene />
    </Sequence>
  </AbsoluteFill>
);
