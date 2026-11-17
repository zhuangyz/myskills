// 视觉系统唯一事实来源。场景文件禁止出现色值 / 字号 / 曲线。
// 由 references/02-token-推导.md 的八步推导得出，推完即冻结。

export const CANVAS = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 450,
};

export const FONTS = {
  serif: { family: 'VideoSerif', file: 'fonts/serif.woff2', weight: '500' },
  mono: { family: 'VideoMono', file: 'fonts/mono.woff2', weight: '400' },
} as const;

export const COLORS = {
  bg: '#14100E',
  ink: '#F2EBE0',
  ink2: 'rgba(242,235,224,0.62)',
  ink3: 'rgba(242,235,224,0.32)',
  line: 'rgba(242,235,224,0.14)',
  accentRGB: '192,138,94', // 只用于光，不用于字
  glowAlpha: 0.18,
  transparentWarm: 'rgba(20,16,14,0)',
};

export const TYPE = {
  display: 300,
  title: 88,
  body: 44,
  caption: 24,
  label: 21, // 拉丁小标签，低于中文下限是允许的
};

export const SPACE = [8, 16, 24, 40, 64, 96];

export const MOTION = {
  curve: [0.22, 1, 0.36, 1] as [number, number, number, number],
  durations: { short: 600, medium: 900, long: 1200 },
  maxShift: 8,
};

// 画面由 3D / 图形生成时必填：先选档位，再决定要不要那四项后处理
// 写实 / 半写实 / 风格化 / 图形化 —— 半写实缺任何一项后处理就塌成塑料感
export const LOOK = {
  tier: 'graphic' as 'realistic' | 'semi-realistic' | 'stylized' | 'graphic',
  requiredPost: ['bloom', 'dof', 'motion-blur', 'grain'], // 仅 semi-realistic 全给
};

// 有实拍素材时必填：全局色调 + 逐素材曝光
export const GRADE = {
  global: 'saturate(0.82) contrast(1.08)',
  perClip: { 'beans.mp4': 0.8, 'pour.mp4': 0.62 } as Record<string, number>,
};

// 文字压在动态素材上的兜底
export const TEXT_SAFE_LAYER =
  'linear-gradient(180deg, rgba(20,16,14,0.72) 0%, rgba(20,16,14,0.18) 34%, rgba(20,16,14,0.62) 72%, rgba(20,16,14,0.94) 100%)';
