import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { Scene } from './Scene';
import { CANVAS, COLORS } from './tokens';

// 时间轴必须与 storyboard.md 一一对应。
// assert.mjs 会解析这里的字面量来核对切点，所以不要改成变量。
export const PromoVideo: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
    <Sequence from={0} durationInFrames={CANVAS.durationInFrames}>
      <Scene />
    </Sequence>
  </AbsoluteFill>
);
