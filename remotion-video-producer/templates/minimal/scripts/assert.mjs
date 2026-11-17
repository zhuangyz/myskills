#!/usr/bin/env node
/**
 * 视频生产流水线的可执行门禁。
 * 存在的理由：渲染成功从来不等于交付合格。本项目实测五次翻车，退出码全是 0。
 *
 * 用法：
 *   node scripts/assert.mjs --project . --stage g2
 *   node scripts/assert.mjs --project . --stage g3
 *   node scripts/assert.mjs --project . --stage g4 --mp4 out/video.mp4 --copy "多一克，就不是这个味。"
 *   node scripts/assert.mjs --project . --stage g4 --mp4 out/video.mp4 --sheet   # 生成九宫格抽帧
 * 退出码：有 FAIL 时为 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const PROJECT = path.resolve(opt('project', '.'));
const STAGE = opt('stage', 'all');
const MP4 = opt('mp4', null);
const COPY = args.reduce((acc, a, i) => (a === '--copy' ? [...acc, args[i + 1]] : acc), []);
const SHEET = args.includes('--sheet');

const results = [];
const dedupe = (set) => [...set];
const add = (level, name, msg, detail = []) => results.push({ level, name, msg, detail });

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.cache', 'build']);
function walk(dir, exts) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const srcFiles = walk(path.join(PROJECT, 'src'), ['.ts', '.tsx']);
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(PROJECT, f);

/* ---------- 1. 字体：注册 vs 使用 ---------- */
function checkFonts() {
  const registered = new Set();
  const declared = new Set();   // tokens / theme 里声明的族名
  let hasDynamicFace = false;
  let hasCheckAssertion = false;
  for (const f of srcFiles) {
    const s = read(f);
    for (const m of s.matchAll(/new\s+FontFace\(\s*['"]([^'"]+)['"]/g)) registered.add(m[1]);
    if (/new\s+FontFace\(\s*[A-Za-z_$]/.test(s)) hasDynamicFace = true;
    for (const m of s.matchAll(/family:\s*['"]([^'"]+)['"]/g)) declared.add(m[1]);
    if (/document\.fonts\.check\(/.test(s)) hasCheckAssertion = true;
  }
  const known = new Set([...registered, ...(hasDynamicFace ? declared : [])]);

  const used = new Map();
  for (const f of srcFiles) {
    const s = read(f);
    for (const m of s.matchAll(/fontFamily:\s*['"]([A-Za-z][\w-]*)['"]/g)) {
      if (!used.has(m[1])) used.set(m[1], rel(f));
    }
  }

  const missing = [...used.keys()].filter((u) => !known.has(u));
  if (used.size === 0 && known.size === 0) {
    add('WARN', 'fonts', '没有找到显式 fontFamily，若使用了自定义字体请确认');
  } else if (dedupe(known).length === 0) {
    add('FAIL', 'fonts', '使用了 fontFamily 但没有任何 FontFace 注册');
  } else if (missing.length) {
    add('FAIL', 'fonts', `这些字体被使用但从未 FontFace 注册：${missing.join(', ')}`, missing.map((m) => `${m} ← ${used.get(m)}`));
  } else {
    add('PASS', 'fonts', `${dedupe(known).length} 个字体族已注册（${hasDynamicFace ? 'tokens 动态注册' : '字面量注册'}）`);
  }

  if (!hasCheckAssertion) {
    add('FAIL', 'fonts', '缺少 document.fonts.check() 断言——字体没加载时会静默回退，渲染照样成功');
  } else {
    add('PASS', 'fonts', '存在 document.fonts.check() 断言');
  }

  // 内联 @font-face：第一次翻车的根因（解析时序竞态），任何 tsx 里出现都要拦
  const inlineFace = srcFiles.filter((f) => /@font-face/.test(read(f)));
  if (inlineFace.length) {
    add('FAIL', 'fonts', '内联 @font-face 注册（解析时序竞态，实测会导致同一条片子两次渲染一次对一次错）', inlineFace.map(rel));
  }

  const fontDir = path.join(PROJECT, 'public', 'fonts');
  const files = fs.existsSync(fontDir) ? fs.readdirSync(fontDir).filter((f) => /\.(woff2?|ttf|otf)$/.test(f)) : [];
  if (files.length === 0) {
    add('WARN', 'fonts', 'public/fonts 下没有字体文件（若全部走系统字体可忽略）');
  } else {
    add('PASS', 'fonts', `内嵌字体 ${files.length} 个：${files.join(', ')}`);
  }

  // 字形覆盖：只能靠清单比对，做不了 cmap 解析，所以要求维护清单
  if (COPY.length) {
    const manifest = path.join(fontDir, 'glyphs.txt');
    if (!fs.existsSync(manifest)) {
      add('WARN', 'glyph', '缺少 public/fonts/glyphs.txt 字形清单，无法验证子集覆盖（实测：缺 2 个字形会让同屏数字混用两种字体）');
    } else {
      const have = new Set([...read(manifest)]);
      const need = new Set([...COPY.join('')].filter((c) => c.trim()));
      const lack = [...need].filter((c) => !have.has(c));
      if (lack.length) add('FAIL', 'glyph', `字幕用到但子集缺失的字：${lack.join(' ')}`);
      else add('PASS', 'glyph', `字形清单覆盖 ${need.size} 个字`);
    }
  }
}

/* ---------- 2. 硬编码扫描 ---------- */
function checkHardcoded() {
  const allowed = /(tokens|constants|theme|fonts)\.(ts|tsx)$/;
  const hits = [];
  for (const f of srcFiles) {
    if (allowed.test(f)) continue;
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      const patterns = [
        { re: /#[0-9a-fA-F]{3,8}\b/, label: '色值' },
        { re: /\brgba?\(/, label: 'rgba' },
        { re: /fontSize:\s*\d+\b/, label: '裸字号' },
      ];
      // rgba(${TOKEN},…) 的 alpha 来自 tokens，不算硬编码
      const tokenDerived = /rgba?\(\s*\$\{/.test(line);
      for (const p of patterns) {
        if (p.label === 'rgba' && tokenDerived) continue;
        if (p.re.test(line)) hits.push(`${rel(f)}:${i + 1}  ${p.label}  ${line.trim().slice(0, 70)}`);
      }
    });
  }
  if (hits.length) add('FAIL', 'hardcoded', `${hits.length} 处绕过 tokens 的硬编码`, hits.slice(0, 12));
  else add('PASS', 'hardcoded', '场景文件无硬编码色值 / 裸字号');
}

/* ---------- 3. 节奏：切点与时长分布 ---------- */
function checkRhythm() {
  const compFiles = srcFiles.filter((f) => /Root\.tsx$/.test(f));
  let fps = 30;
  for (const f of compFiles) {
    const m = read(f).match(/fps=\{(\d+)\}/);
    if (m) fps = Number(m[1]);
  }

  const seqs = [];
  for (const f of srcFiles) {
    const s = read(f);
    for (const m of s.matchAll(/<Sequence\s+from=\{(\d+)\}\s+durationInFrames=\{(\d+)\}/g)) {
      seqs.push({ from: Number(m[1]), dur: Number(m[2]), file: rel(f) });
    }
  }

  if (seqs.length < 2) {
    add('WARN', 'rhythm', '未找到字面量的 <Sequence from durationInFrames>，无法核对切点；若用了变量请改用字面量');
    return;
  }

  seqs.sort((a, b) => a.from - b.from);
  const durations = [...new Set(seqs.map((s) => s.dur))];
  const gaps = seqs.slice(1).map((s, i) => (s.from - seqs[i].from) / fps);

  const tooShort = gaps.filter((g) => g < 1.5);
  if (tooShort.length) add('FAIL', 'rhythm', `有 ${tooShort.length} 个切点间隔短于 1.5s：${tooShort.map((g) => g.toFixed(2) + 's').join(', ')}`);

  const counts = seqs.reduce((m, s) => ((m[s.dur] = (m[s.dur] || 0) + 1), m), {});
  const maxSame = Math.max(...Object.values(counts));
  if (maxSame > 1) {
    add('WARN', 'rhythm', `有 ${maxSame} 个镜头时长相同（${Object.entries(counts).map(([d, c]) => `${d}帧×${c}`).join(' ')}）——按字数分配时长会让节奏变平，应按职能重量分配`);
  }
  if (!tooShort.length) add('PASS', 'rhythm', `切点 ${seqs.length - 1} 个，最短间隔 ${Math.min(...gaps).toFixed(2)}s`);

  if (COPY.length) {
    const long = COPY.filter((c) => [...c].length > 12);
    if (long.length) add('WARN', 'copy', `${long.length} 条文案超过 12 字`, long.map((c) => `${[...c].length} 字：${c}`));
    else add('PASS', 'copy', `文案长度均 ≤12 字`);
  }
}

/* ---------- 4. 死时间：ffmpeg freezedetect ---------- */
function findFfmpeg() {
  const sys = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (sys.status === 0 && sys.stdout.trim()) return { bin: sys.stdout.trim(), dir: null };
  const base = path.join(PROJECT, 'node_modules', '@remotion');
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      if (!d.startsWith('compositor-')) continue;
      const bin = path.join(base, d, 'ffmpeg');
      if (fs.existsSync(bin)) return { bin, dir: path.join(base, d) };
    }
  }
  return null;
}

function checkDeadTime() {
  if (!MP4) return add('WARN', 'deadtime', '未提供 --mp4，跳过硬镜检测');
  const file = path.resolve(PROJECT, MP4);
  if (!fs.existsSync(file)) return add('FAIL', 'deadtime', `找不到 ${MP4}`);

  const ff = findFfmpeg();
  if (!ff) return add('WARN', 'deadtime', '找不到 ffmpeg，跳过（可设 REMOTION_FFMPEG 环境变量）');

  const env = { ...process.env };
  if (ff.dir && process.platform === 'darwin') env.DYLD_LIBRARY_PATH = ff.dir;

  const r = spawnSync(ff.bin, ['-hide_banner', '-i', file, '-vf', 'freezedetect=n=-60dB:d=0.5', '-map', '0:v', '-f', 'null', '-'], { env, encoding: 'utf8' });
  const log = (r.stderr || '') + (r.stdout || '');
  const starts = [...log.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const durs = [...log.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));

  if (starts.length === 0) return add('PASS', 'deadtime', '全片无 ≥0.5s 的静止段');

  const long = starts.map((s, i) => ({ start: s, dur: durs[i] || 0 })).filter((x) => x.dur >= 0.5);
  const severe = long.filter((x) => x.dur >= 1);
  const fmt = long.map((x) => `${x.start.toFixed(2)}s 起静止 ${x.dur.toFixed(2)}s`);
  if (severe.length) add('FAIL', 'deadtime', `${severe.length} 段静止超过 1s（观众会以为卡住了）`, fmt.slice(0, 8));
  else add('WARN', 'deadtime', `${long.length} 段静止 0.5–1s`, fmt.slice(0, 8));
}

/* ---------- 4.5 九宫格抽帧：机器备料，人眼判断 ---------- */
function makeContactSheet() {
  if (!MP4) return add('WARN', 'sheet', '未提供 --mp4，跳过抽帧');
  const file = path.resolve(PROJECT, MP4);
  if (!fs.existsSync(file)) return add('FAIL', 'sheet', `找不到 ${MP4}`);

  const ff = findFfmpeg();
  if (!ff) return add('WARN', 'sheet', '找不到 ffmpeg，跳过抽帧');

  const out = path.join(PROJECT, 'out', 'contact-sheet.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const r = spawnSync(
    ff.bin,
    ['-hide_banner', '-v', 'error', '-y', '-i', file,
     '-vf', 'fps=1/2,scale=480:-1,tile=5x2:padding=6:margin=6:color=0x141414',
     '-frames:v', '1', out],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) return add('WARN', 'sheet', `抽帧失败：${(r.stderr || '').trim().slice(0, 120)}`);

  add('WARN', 'sheet', `九宫格已生成 ${path.relative(PROJECT, out)} — 需人眼判三条`, [
    '1) 任一格主体 <8% 且画面无结构 → 该镜头判负',
    '2) 相邻两格几乎一样 → 节奏停滞',
    '3) 九格没有一格能单独当封面 → 缺强画面，重做分镜',
  ]);
}

/* ---------- 5. 交付提醒 ---------- */
function checkDelivery() {
  const has = fs.existsSync(path.join(PROJECT, 'delivery.md'));
  add(has ? 'PASS' : 'WARN', 'delivery', has ? '存在 delivery.md' : '缺少 delivery.md（画布参数 / 素材授权 / 字体清单 / 已知限制）');
}

const stages = STAGE === 'all' ? ['g2', 'g3', 'g4', 'g5'] : [STAGE];
if (stages.includes('g2') || stages.includes('g3')) { checkFonts(); checkHardcoded(); }
if (stages.includes('g4')) { checkRhythm(); if (MP4) checkDeadTime(); if (MP4 && SHEET) makeContactSheet(); }
if (stages.includes('g5')) checkDelivery();

const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };
console.log(`\n[assert] ${rel(PROJECT) || '.'}  stage=${stages.join(',')}\n`);
for (const r of results) {
  console.log(`  ${icon[r.level]} ${r.name.padEnd(10)} ${r.msg}`);
  for (const d of r.detail) console.log(`      ${d}`);
}
const fails = results.filter((r) => r.level === 'FAIL').length;
console.log(`\n[assert] ${fails ? `FAIL ×${fails}` : 'PASS'}\n`);
process.exit(fails ? 1 : 0);
