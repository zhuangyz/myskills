import React from 'react';
import { Composition } from 'remotion';
import { Scene } from './Scene';
import { PromoVideo } from './PromoVideo';
import { CANVAS } from './tokens';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Scene"
      component={Scene}
      durationInFrames={90}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
    />
    <Composition
      id="Full"
      component={PromoVideo}
      durationInFrames={CANVAS.durationInFrames}
      fps={CANVAS.fps}
      width={CANVAS.width}
      height={CANVAS.height}
    />
  </>
);
