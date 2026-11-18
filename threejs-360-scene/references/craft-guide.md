# 实操配方：风格 · 地形 · 水 · 光 · 交互 · 动效

配方来自三个定稿项目，按需取用。每条都写明"为什么"，遇到反直觉的不要自行"优化"掉。

## 风格翻译表：治愈插画风 → 具体手段

| 规格里的说法 | 实现手段 |
|---|---|
| 不要黑色硬描边 | 不用 outline/edge geometry，全靠明暗+色相区分；轮廓感来自 AO 和 rim light |
| 写实材质、平滑光影 | MeshStandardMaterial（不开 flatShading），hemi+directional 拉光比（hemi ~0.5 / sun ~1.8） |
| 边缘倒圆角 | 小屋/木箱用倒角几何或分段圆柱+径向倒角；避免纯 BoxGeometry 直角 |
| 木纹/锈迹/侵蚀 | canvas 程序化纹理：横向条纹+噪声扰动=木纹；斑驳=低频噪声阈值抠色块 |
| 避免大面积纯色 | 顶点色叠加伪 AO（低处/凹处压暗）+ 噪声调制 roughness/color |
| 表面质感"积木感" | 三件套：bumpMap（程序化凸点 canvas）+ roughnessMap + 分段几何中频径向位移。**bumpScale 0.45-0.6**，>1 法线全乱、饱和度塌掉 |
| 高频细节（斑点/细条纹） | 用 canvas 贴图走 UV，**不要**用顶点色/顶点噪声——会被三角形插值抹平（海星斑点五轮不可见的教训） |

## 地形（海岸/山地通用）

灯塔项目验证过的流程：
1. **CatmullRom 闭合样条**定义海岸线；
2. 网格点相对样条做**内外符号距离** → 生成高度场（海里为负、陆地随距离抬升）；
3. `PADS` 数组把建筑地基压平；`BEACHES` 矩形把指定岸线段改成缓坡沙滩；
4. 顶点色：砂/草/岩三色按高度和噪声混合 + 伪 AO。
5. **远山**：锥体必须沿切向拉长 + 顶点噪声扰动，否则是"完美圆锥"假山。
6. **遮挡**：某物体被山脊挡住时，单改它脚下 pad 高度没用——要同时压低挡视线的高斯山包并外移基座。

## 水面

- 菲涅尔反射 + 法线扰动（2-3 层滚动噪声法线贴图，程序化生成）；
- 波浪在**顶点着色器**做（JS 拼接 GLSL 字符串进材质 onBeforeCompile），波浪参数统一放 config（`LF.WAVES`），JS 侧同组参数实现 `waveH()/waveGrad()` 采样——**船/浮球的起伏必须采样同一组波**，否则船穿浪或悬空；
- 时间段反光带（朝阳/月光）：在水面着色器里沿太阳方位角画高斯亮带，别用贴图。

## 天空穹顶与雾

- 天空用大球 + 渐变 ShaderMaterial（顶点传高度，片元插值多段色标：粉橙→浅蓝等）；
- **关键坑**：ShaderMaterial 不经过内置 tonemap，与内置材质管线"同色不同亮度"会产生海平面色差线——ShaderMaterial 里**手写同款 ACES（含输入变换矩阵）**；
- r160+ 的 fog 计算发生在 tonemap 之后，自定义双段距离雾 patch 必须操作 `gl_FragColor.rgb`；
- 雾色**必须比地面亮**，暗雾会在半雾区形成"地平线暗带"；
- 贴地薄雾：水平大面片 + 极低透明度。相机 1.6m 人眼恰好常在雾层高度内，掠射角下 alpha 0.1 就会洗白全屏——**alpha ≤0.08 且雾片离相机远**。

## 光照与阴影

- hemi（天空色/地面色）+ directional（主光，低角度暖色按时段定）+ 少量点光补室内/光源体；
- 阴影 2048 PCFSoft，directional 的 shadow camera 范围收紧到场景核心区，bias 调到无条纹痤疮（约 -0.0002~-0.0005，土星纹=回调）；
- 拉光比是氛围核心：暗部靠 hemi+AO 压，亮部靠 sun 提，不靠改 exposure。

## 自研 postfx（不用 EffectComposer）

灯塔定稿链路（直接改造复用 `灯塔小渔港/js/postfx.js`）：
1. 场景渲染进 HalfFloat HDR RT（带 DepthTexture）；
2. 亮度提取 → 两级高斯泛光（1/4 分辨率）；
3. 半分辨率模糊 RT 做远景景深（按 depth 混合）；
4. 合成 pass：手写 ACES + gamma、胶片颗粒、暗角、色彩分级（阴影偏青、高光偏暖）。
- **头号坑（全屏白纱病）**：blur 链中漏设 tDiffuse → 采样正在写入的 RT → INVALID_OPERATION 整个 draw 被静默丢弃，画面只剩 clear color 被 bloom 叠成"白纱"。每次 blur 前**显式重置 tDiffuse**；用 readRenderTargetPixels 逐 pass 采样定位（坐标按各 RT 自己的分辨率换算）。

## 交互标准包（controls.js）

- 拖拽/单指：yaw 无限制，pitch 限幅（约 ±75°，碰地碰天都丑）；惯性阻尼 0.08 左右；
- 滚轮/双指：FOV 45~75 限幅；
- WASD/方向键：速度 ~2m/s，走动范围用**可行走区域多边形/圆列表**夹住（栈桥+岸线），别用简单半径——用户会走到海里；
- 闲置 ≥5s：缓慢自动环视（yaw 匀速漂移），任何输入立即接管；
- **闲置计时必须用真实 rawDt 累加**：后台标签 rAF 深度节流（~0.25fps）时物理 dt 有 0.05 上限夹断，5 秒真实时间只走 0.25 秒。渲染循环另加 `setInterval(renderOnce, 180)` 兜底，否则无头截图环境卡死。

## 动效清单（ambient.js）

对照规格动效段逐条实现，常见件：
- 船/浮球：位置+倾角随 `waveH/waveGrad` 采样；
- 旋转光束（灯塔/探照灯）：透明加法混合锥体 + 绕轴旋转，别用真 volumetric；
- 鸟群：几个关键帧样条循环 + 翅膀 sin 摆动；
- 浪花：礁石边缘周期性白色面片缩放淡出；
- 烟囱烟/炊烟：sprite 序列上升+膨胀+淡出；
- 反光带/水面光柱：见水面配方；
- 粒子（萤火/落花）：**限在中远带状区**，近景平点粒子会被透视放大成光斑。

## 模块划分模板（16 文件，依赖顺序）

```
index.html          唯一入口，经典 script 顺序引入
lib/three.min.js    r128 UMD（从灯塔项目复制）
js/config.js        种子、波浪参数、方位常量、全部可调参数
js/noise.js         种子 PRNG + 2D/3D 值噪声/fbm
js/glsl.js          共享 GLSL 字符串（波浪顶点、水面片元等）
js/textures.js      canvas 程序化纹理工厂（木/岩/沙/墙/法线）
js/geom.js          通用几何工厂（倒角箱、样条放样、低模树）
js/sky.js           天空穹顶 + 太阳/月亮 + 星星
js/terrain.js       样条高度场地形 + 顶点色
js/ocean.js         水面材质 + 波浪 + 反光带
js/lighthouse.js    ← 换成你的主题主体（如 castle.js / temple.js）
js/village.js       中景建筑群
js/harbor.js        近景道具群（船/桩/箱子）
js/ambient.js       动效清单实现
js/controls.js      交互标准包
js/postfx.js        后期链
js/main.js          初始化顺序 + 渲染循环 + resize
```
