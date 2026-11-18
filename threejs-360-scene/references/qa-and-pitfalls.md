# 验收闭环与踩坑库

## 美术评审协议（三个定稿项目都用它，不可省略）

程序写完 ≠ 达标。美术质量必须走截图评审循环：

1. **调试机位**：URL 参数支持机位切换（`?view=1..4` 或 `?angle=e|n|s|w`，`&clean=1` 藏调试 HUD，`&fps=1` 显帧率），数字键 1-4 也可切换。机位按方位约定取东南西北四个固定点，`window.__setAngle/__ready/__errors/__dbg` 挂成调试句柄。
2. **截图**：每个机位截一张 PNG（存 `shots/`），截图前 setViewportSize 并全图确认（截图 clip 坐标可能错位）。
3. **派子 Agent 只看图**：把 4 张图交给一个"美术指导"子 Agent，**只看截图、不看代码**，按严重度列问题：
   - P0 = 穿帮/空白断面/场景边缘可见/渲染异常/构图残缺；
   - P1 = 明显丑（假山圆锥、色带、比例失衡、光照平淡）；
   - P2 = 可打磨（细节缺失、配色微调）。
   **判定标准原文写进子 Agent 的 prompt**，否则它会客气地放水。
4. **修 → 重截 → 再评**，直到 **零 P0 且 P1≤2**。一般 2-5 轮。
5. **渲染异常别看图猜**：用 `readRenderTargetPixels` 直读 RT 像素定位色带/白屏归属，比看图快得多。

**参考图校准教训**（用户给了参考图时）：只兑现"层级"不兑现"数量"会翻车——珊瑚参考里末级细枝必须 5-8 根/簇、总量 3-5 倍才形成目标剪影；"自然色"不等于砍色彩维度；**顺光布光**（主光移到相机一侧），逆光只剩剪影。

## 调试技巧

- `<head>` 里挂 `window.addEventListener('error', e => window.__errors.push(...))` + WebGL/GLSL 编译错误钩子——GLSL 类型错（如 vec2 取 .z）**静默编译失败**，表现为"物体没渲染"而非报错。
- 本地预览 `python3 -m http.server 8161 --directory <项目目录>`；Chrome 对无 Cache-Control 的响应做启发式缓存，**改完 JS 必须破缓存**：`fetch(url, {cache:'reload'})` 逐文件刷新再 reload，否则验的是旧代码（改了没生效十有八九是这个）。
- 最终必须用 file:// 双击 index.html 验一遍（这才是交付形态，http 只用于调试）。

## 踩坑库（现象 → 根因 → 修法）

### 加载与环境
1. file:// 下 ES module 被 CORS 拦 → 经典 script；three 用 r128 UMD 本地 lib/（r150+ 无 UMD；jsdelivr 直连常失败，npmmirror 下载）。
2. 后台/被遮挡标签 rAF 深度节流（~0.25fps）→ 闲置计时/自动环视用真实 rawDt 累加（物理 dt 保持 0.05 夹断）；`setInterval(renderOnce,180)` 兜底渲染；加载步骤用 setTimeout 推进。
3. 改 JS 无效 → http.server 启发式缓存 → fetch cache:'reload' 破缓存。

### 渲染管线
4. 全屏白纱（只剩雾色/清屏色）→ postfx blur 链漏设 tDiffuse，采样正在写入的 RT，INVALID_OPERATION 静默丢 draw → 每次 blur 前显式重置 tDiffuse。
5. 天空与海面交界色差线 → ShaderMaterial 不经内置 tonemap → 手写同款 ACES（含输入矩阵）。
6. r160+ fog 在 tonemap 之后 → 自定义雾 patch 操作 gl_FragColor.rgb。
7. 物体凭空消失、无报错 → GLSL 类型错误静默编译失败，或 BufferAttribute itemSize 不符整 draw 静默失败 → __errors 钩子 + 检查 attribute 定义。
8. InstancedMesh 不显示 → 矩阵含 NaN（漏存字段）。
9. ExtrudeGeometry 造的物体整个埋进地里 → rotateX 方向反了。

### 材质与纹理
10. "积木光滑感" → 只有顶点色没有凹凸 → bumpMap+roughnessMap+径向位移三件套（bumpScale 0.45-0.6）。
11. 高频斑点/细条纹看不见 → 顶点噪声被三角形插值抹平 → canvas 贴图走 UV。
12. 物体从某方向看隐形 → PlaneGeometry 默认面朝 +z → 转 Y 或 DoubleSide。
13. bumpScale 调大后颜色发灰发闷 → 法线全乱、饱和度塌 → 降回 ≤0.6。

### 雾与氛围
14. 半雾区出现"地平线暗带" → 雾色比地面暗 → 雾必须比地面亮。
15. 贴地薄雾把全屏洗白 → 相机 1.6m 在雾层高度内、掠射角叠加 → alpha ≤0.08 且雾片远离相机。
16. 近景出现诡异光斑 → 平点粒子透视放大 → 粒子限中远带状区。

### 地形与构图
17. 远山像"完美圆锥"假山 → 沿切向拉长 + 顶点噪声。
18. 建筑被山脊挡住，抬高 pad 无效 → 同时压低挡视线的高斯山并外移基座。

### 性能预算参考
- DPR ≤1.5；阴影 2048 PCFSoft；远景低模 + 无阴影投射；
- postfx 3-4 pass（泛光 1/4 分辨率、DoF 半分辨率）；
- 面数感觉卡先查：阴影 cast 数量、粒子数、透传 overdraw（薄雾/光束叠加）。

### 色彩与可见性（月牙泉项目新增）
22. 中等饱和色洗成灰白粉绿（驼毛/树叶发白）→ r128 把材质色值当线性色用，末端 gamma 又提亮一档 → 这类"自然色"要按视觉补偿取深一档（或统一 convertSRGBToLinear）。贴图若标 sRGB 则不受影响——同一物体"贴图饱和、纯色发白"就是这个根因。
23. 粒子颜色接近背景色 = 隐形（米色吹沙叠亮黄沙）→ 亮背景上的飘尘/吹沙用 AdditiveBlending 乳白雾带；暗背景用普通混合。
24. 出生点 2m 内的小道具（灯笼等）会怼成巨大色球挡画面 → 布置近景道具时按"距出生点距离"过滤，或视觉漫游一遍四机位再定。
25. 自定义水面 ShaderMaterial 不接收阴影 → 岸边石影"脱节"穿帮 → 把水体做成半透明（浅水透底透影），同时正好满足"清澈"规格。
26. 破缓存批量 fetch(cache:'reload') 会竞态 Failed to fetch → 逐文件 try-catch 小步破缓存。
27. TubeGeometry/世界坐标 baked 几何不可再用带平移的矩阵 add 进 Batch（会二次位移飞走）→ 传单位阵。
28. 每向评审机位的 pitch 要按该向构图单独调（如北向看脊线风沙流 pitch≈-5；-15 会把脊线推出画面顶）。
