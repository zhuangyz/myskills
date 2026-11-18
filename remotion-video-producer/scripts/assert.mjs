#!/usr/bin/env node
/**
 * 视频生产流水线的可执行门禁。全仓库只有这一份；项目里的 scripts/assert.mjs 只是转发器。
 * 存在的理由：渲染成功从来不等于交付合格——翻车时退出码全是 0。
 *
 * 原则：fail-closed。某项检查缺输入、缺工具、读不懂代码 → FAIL，而不是 WARN 后放行。
 *       "什么都没查到"绝不等于"通过"。
 *
 * 单一事实来源：
 *   src/spec.json   平台、阈值、全部文案（按字体分组）、豁免的定格段
 *   src/tokens.ts   视觉系统（颜色 / 字号 / 曲线 / 字体文件 / 质感档位）
 *   storyboard.md   分镜七列
 *
 * 用法：
 *   node scripts/assert.mjs --project . --stage g1
 *   node scripts/assert.mjs --project . --stage g2 [--compare out/cover.png --ref reference/ref.jpg]
 *   node scripts/assert.mjs --project . --stage g3
 *   node scripts/assert.mjs --project . --stage g4 --mp4 out/video.mp4 [--sheet] [--zoom [秒]]
 *   node scripts/assert.mjs --project . --stage g5 --mp4 out/video.mp4
 *   node scripts/assert.mjs --project . --stage all --mp4 out/video.mp4
 * 退出码：有 FAIL 为 1；有 HUMAN（需要人眼判断的产物）时仍为 0，但必须停下等用户放行。
 * 依赖：Node ≥18；G4 / G5 / --compare 需要 ffmpeg + ffprobe（系统或 node_modules/@remotion/compositor-*）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const VERSION = '2026-11-18';

/* ---------- 参数 ---------- */
const args = process.argv.slice(2);
const argOf = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const PROJECT = path.resolve(argOf('project', '.'));
const STAGE = argOf('stage', null);
const MP4 = argOf('mp4');
const SHEET = args.includes('--sheet');
const ZOOM = args.includes('--zoom');
const ZOOM_T = argOf('zoom');
const COMPARE = argOf('compare');
const REF = argOf('ref');
if (args.includes('--copy')) {
  console.error('[assert] --copy 已废弃：文案只在 src/spec.json 的 copy 字段里维护一份。');
  process.exit(2);
}

const STAGES_ALL = ['g1', 'g2', 'g3', 'g4', 'g5'];
if (!STAGE && !COMPARE) {
  console.error('[assert] 必须指定 --stage g1|g2|g3|g4|g5|all');
  process.exit(2);
}
const stages = STAGE === 'all' ? STAGES_ALL : STAGE ? [STAGE] : [];
for (const s of stages) if (!STAGES_ALL.includes(s)) { console.error(`[assert] 未知阶段 ${s}`); process.exit(2); }

/* ---------- 结果 ---------- */
const results = [];
// HUMAN = 机器只备了料，判断必须由人做；出现即本轮停下等放行
const add = (level, name, msg, detail = []) => results.push({ level, name, msg, detail });

/* ---------- 文件工具 ---------- */
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
const P = (...p) => path.join(PROJECT, ...p);
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(PROJECT, f) || '.';
const exists = (f) => fs.existsSync(f);

// 去掉注释但保留换行，行号不变
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
   .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));

const srcFiles = walk(P('src'), ['.ts', '.tsx', '.js', '.jsx', '.css']);

/* ---------- spec.json：平台、阈值、文案 ---------- */
const PRESETS = {
  // 竖屏信息流：切得快，标题短
  douyin: { minShotSec: 0.8, maxCopyChars: 12, maxSubtitleChars: 16 },
  kuaishou: { minShotSec: 0.8, maxCopyChars: 12, maxSubtitleChars: 16 },
  tiktok: { minShotSec: 0.8, maxCopyChars: 12, maxSubtitleChars: 16 },
  reels: { minShotSec: 0.8, maxCopyChars: 12, maxSubtitleChars: 16 },
  shorts: { minShotSec: 0.8, maxCopyChars: 12, maxSubtitleChars: 16 },
  xiaohongshu: { minShotSec: 1.0, maxCopyChars: 12, maxSubtitleChars: 16 },
  'wechat-channels': { minShotSec: 1.0, maxCopyChars: 12, maxSubtitleChars: 18 },
  // 横屏 / 长内容 / 官网：给观众读的时间
  bilibili: { minShotSec: 1.5, maxCopyChars: 14, maxSubtitleChars: 20 },
  youtube: { minShotSec: 1.5, maxCopyChars: 14, maxSubtitleChars: 20 },
  web: { minShotSec: 1.5, maxCopyChars: 12, maxSubtitleChars: 20 },
  keynote: { minShotSec: 2.0, maxCopyChars: 12, maxSubtitleChars: 20 },
  custom: {},
};
const RULE_DEFAULTS = { freezeWarnSec: 0.5, freezeFailSec: 1.0, sceneThreshold: 0.3, minSubjectPct: 8 };

let SPEC = null;
let RULES = null;
function loadSpec() {
  if (SPEC !== null) return SPEC;
  const f = P('src', 'spec.json');
  if (!exists(f)) { add('FAIL', 'spec', '缺少 src/spec.json（平台 / 阈值 / 全部文案的唯一来源）'); return (SPEC = false); }
  try { SPEC = JSON.parse(read(f)); } catch (e) { add('FAIL', 'spec', `src/spec.json 解析失败：${e.message}`); return (SPEC = false); }
  const preset = PRESETS[SPEC.platform];
  if (!preset) {
    add('FAIL', 'spec', `platform="${SPEC.platform}" 不认识；可选 ${Object.keys(PRESETS).join(' / ')}`);
    return (SPEC = false);
  }
  RULES = { ...RULE_DEFAULTS, ...preset, ...(SPEC.rules || {}) };
  const need = ['minShotSec', 'maxCopyChars', 'maxSubtitleChars'].filter((k) => typeof RULES[k] !== 'number');
  if (need.length) { add('FAIL', 'spec', `platform=custom 时 rules 必须给出：${need.join(', ')}`); return (SPEC = false); }
  if (!SPEC.copy || typeof SPEC.copy !== 'object' || !Object.keys(SPEC.copy).length) {
    add('FAIL', 'spec', 'spec.json 的 copy 为空——全部文案必须按字体分组登记在这里');
    return (SPEC = false);
  }
  add('PASS', 'spec', `platform=${SPEC.platform}  最短镜头 ${RULES.minShotSec}s · 标题 ≤${RULES.maxCopyChars} · 字幕 ≤${RULES.maxSubtitleChars}`);
  return SPEC;
}
// copy 条目可以是字符串，或 { text, kind: 'subtitle' }
const copyEntries = () =>
  Object.entries(SPEC.copy).flatMap(([font, list]) =>
    (Array.isArray(list) ? list : []).map((c) => (typeof c === 'string' ? { font, text: c, kind: 'title' } : { font, kind: 'title', ...c })));
const norm = (s) => s.replace(/\s+/g, '');

/* ---------- tokens.ts：字体 / 画布 / 档位 ---------- */
function tokensSrc() {
  const f = P('src', 'tokens.ts');
  return exists(f) ? stripComments(read(f)) : null;
}
function blockAfter(src, marker) {
  const i = src.search(marker);
  if (i < 0) return null;
  const start = src.indexOf('{', i);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start + 1, j);
  }
  return null;
}
function parseFonts() {
  const src = tokensSrc();
  if (!src) return null;
  const body = blockAfter(src, /export\s+const\s+FONTS\b/);
  if (!body) return null;
  const fonts = {};
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{([^}]*)\}/g)) {
    const family = m[2].match(/family\s*:\s*['"]([^'"]+)['"]/)?.[1];
    const file = m[2].match(/file\s*:\s*['"]([^'"]+)['"]/)?.[1];
    if (family && file) fonts[m[1]] = { family, file };
  }
  return Object.keys(fonts).length ? fonts : null;
}
const lookTier = () => tokensSrc()?.match(/tier\s*:\s*['"]([\w-]+)['"]/)?.[1] || null;
const REALISTIC = new Set(['realistic', 'semi-realistic']);

/* ---------- 字体 cmap：构建期真实读字形表 ---------- */
// document.fonts.check(font, text) 不读 cmap：未声明 unicode-range 的字体被当成覆盖全部字符，
// 缺字照样返回 true。所以字形覆盖只能在这里直接读字体文件。
const W2TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
function fontTable(buf, want) {
  const sig = buf.toString('latin1', 0, 4);
  if (sig === 'ttcf') throw new Error('不支持字体集合 .ttc，请先拆成单个字体');
  if (sig === 'wOFF') {
    const n = buf.readUInt16BE(12);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20;
      if (buf.toString('latin1', o, o + 4) !== want) continue;
      const off = buf.readUInt32BE(o + 4), comp = buf.readUInt32BE(o + 8), orig = buf.readUInt32BE(o + 12);
      const data = buf.subarray(off, off + comp);
      return comp < orig ? zlib.inflateSync(data) : data;
    }
    return null;
  }
  if (sig === 'wOF2') {
    if (buf.toString('latin1', 4, 8) === 'ttcf') throw new Error('不支持 WOFF2 字体集合');
    const n = buf.readUInt16BE(12);
    const totalComp = buf.readUInt32BE(20);
    let p = 48;
    const b128 = () => {
      let v = 0;
      for (let i = 0; i < 5; i++) {
        const b = buf[p++];
        v = v * 128 + (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
      throw new Error('WOFF2 UIntBase128 损坏');
    };
    const dir = [];
    for (let i = 0; i < n; i++) {
      const flags = buf[p++];
      let tag = W2TAGS[flags & 0x3f];
      if ((flags & 0x3f) === 63) { tag = buf.toString('latin1', p, p + 4); p += 4; }
      const ver = (flags >> 6) & 3;
      const orig = b128();
      const transformed = tag === 'glyf' || tag === 'loca' ? ver === 0 : ver !== 0;
      dir.push({ tag, len: transformed ? b128() : orig });
    }
    const data = zlib.brotliDecompressSync(buf.subarray(p, p + totalComp));
    let off = 0;
    for (const d of dir) {
      if (d.tag === want) return data.subarray(off, off + d.len);
      off += d.len;
    }
    return null;
  }
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    if (buf.toString('latin1', o, o + 4) !== want) continue;
    const off = buf.readUInt32BE(o + 8), len = buf.readUInt32BE(o + 12);
    return buf.subarray(off, off + len);
  }
  return null;
}
function cmapLookup(file) {
  const cmap = fontTable(fs.readFileSync(file), 'cmap');
  if (!cmap) throw new Error('字体里没有 cmap 表');
  const u16 = (o) => cmap.readUInt16BE(o), s16 = (o) => cmap.readInt16BE(o), u32 = (o) => cmap.readUInt32BE(o);
  const seen = new Set();
  const fns = [];
  for (let i = 0; i < u16(2); i++) {
    const pid = u16(4 + i * 8), eid = u16(6 + i * 8), off = u32(8 + i * 8);
    if (!(pid === 0 || (pid === 3 && (eid === 1 || eid === 10)))) continue;
    if (seen.has(off)) continue;
    seen.add(off);
    const fmt = u16(off);
    if (fmt === 4) {
      const segX2 = u16(off + 6), seg = segX2 / 2;
      const ends = off + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      fns.push((cp) => {
        if (cp > 0xffff) return false;
        for (let k = 0; k < seg; k++) {
          if (cp > u16(ends + 2 * k)) continue;
          const start = u16(starts + 2 * k);
          if (cp < start) return false;
          const delta = s16(deltas + 2 * k), ro = u16(ranges + 2 * k);
          let g;
          if (ro === 0) g = (cp + delta) & 0xffff;
          else { g = u16(ranges + 2 * k + ro + (cp - start) * 2); if (g) g = (g + delta) & 0xffff; }
          return g !== 0;
        }
        return false;
      });
    } else if (fmt === 12 || fmt === 13) {
      const groups = u32(off + 12);
      fns.push((cp) => {
        for (let k = 0; k < groups; k++) {
          const o = off + 16 + k * 12, s = u32(o), e = u32(o + 4), g = u32(o + 8);
          if (cp >= s && cp <= e) return fmt === 13 ? g !== 0 : g + cp - s !== 0;
        }
        return false;
      });
    } else if (fmt === 6) {
      const first = u16(off + 6), cnt = u16(off + 8);
      fns.push((cp) => cp >= first && cp < first + cnt && u16(off + 10 + 2 * (cp - first)) !== 0);
    }
  }
  if (!fns.length) throw new Error('字体里没有可读的 Unicode cmap 子表（格式 4 / 6 / 12 / 13）');
  return (cp) => fns.some((f) => f(cp));
}

/* ---------- ffmpeg ---------- */
let FF;
function ffmpeg() {
  if (FF !== undefined) return FF;
  const env = { ...process.env };
  const sys = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' });
  if (process.env.REMOTION_FFMPEG && exists(process.env.REMOTION_FFMPEG)) FF = { bin: process.env.REMOTION_FFMPEG, env };
  else if (sys.status === 0 && sys.stdout.trim()) FF = { bin: sys.stdout.trim(), env };
  else {
    FF = null;
    const base = P('node_modules', '@remotion');
    if (exists(base)) for (const d of fs.readdirSync(base)) {
      const bin = path.join(base, d, 'ffmpeg');
      if (d.startsWith('compositor-') && exists(bin)) {
        if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = path.join(base, d);
        else env.LD_LIBRARY_PATH = path.join(base, d);
        FF = { bin, env };
        break;
      }
    }
  }
  if (FF) FF.probe = FF.bin.replace(/ffmpeg$/, 'ffprobe');
  return FF;
}
const ff = (a, opts = {}) => spawnSync(FF.bin, ['-hide_banner', ...a], { env: FF.env, encoding: 'utf8', maxBuffer: 64 << 20, ...opts });

let VIDEO;
function requireVideo(name) {
  if (VIDEO) return VIDEO;
  if (VIDEO === false) return null;
  if (!MP4) { add('FAIL', name, '本阶段必须给 --mp4 <成片>；没有成片就没有可验收的东西'); VIDEO = false; return null; }
  const file = path.resolve(PROJECT, MP4);
  if (!exists(file)) { add('FAIL', name, `找不到 ${MP4}`); VIDEO = false; return null; }
  if (!ffmpeg()) { add('FAIL', name, '找不到 ffmpeg / ffprobe——门禁无法执行即不通过（brew install ffmpeg，或设 REMOTION_FFMPEG）'); VIDEO = false; return null; }
  const pr = spawnSync(FF.probe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,width,height:format=duration', '-of', 'json', file], { env: FF.env, encoding: 'utf8' });
  let info;
  try { info = JSON.parse(pr.stdout); } catch { add('FAIL', name, `ffprobe 读不了 ${MP4}`); VIDEO = false; return null; }
  const [num, den] = (info.streams?.[0]?.r_frame_rate || '30/1').split('/').map(Number);
  VIDEO = { file, fps: num / (den || 1), duration: Number(info.format?.duration), width: info.streams?.[0]?.width, height: info.streams?.[0]?.height };
  if (!Number.isFinite(VIDEO.duration)) { add('FAIL', name, '读不出成片时长'); VIDEO = false; return null; }
  return VIDEO;
}
const holds = () => (SPEC && Array.isArray(SPEC.holds) ? SPEC.holds : []);
const inHold = (s, e) => holds().some((h) => s >= h.fromSec - 0.1 && e <= h.toSec + 0.1);

/* ================= G1 规格与分镜 ================= */
const SB_COLS = ['帧', '画面元素', '文案', '文案时序', '素材契约', '主体占比', '运动与转场'];
function checkBrief() {
  const f = P('brief.md');
  if (!exists(f)) return add('FAIL', 'brief', '缺少 brief.md');
  const s = read(f);
  const miss = [['给谁看', /给谁看|受众|观众/], ['时长', /时长|\d+\s*s\b|\d+\s*秒|\d+\s*帧/], ['平台', /平台|投放/], ['画布', /\d{3,4}\s*[×x]\s*\d{3,4}/]]
    .filter(([, re]) => !re.test(s)).map(([k]) => k);
  if (miss.length) add('FAIL', 'brief', `brief.md 缺：${miss.join('、')}（答不出就写默认值并标"假设"）`);
  else add('PASS', 'brief', 'brief.md 三问 + 画布齐全');
}
function parseTables(md) {
  const lines = md.split('\n');
  const tables = [];
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    const header = cells(lines[i]);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push({ line: j + 1, cells: cells(lines[j]) });
    tables.push({ header, rows, line: i + 1 });
    i = j;
  }
  return tables;
}
function checkStoryboard() {
  const f = P('storyboard.md');
  if (!exists(f)) return add('FAIL', 'storyboard', '缺少 storyboard.md');
  const md = read(f);
  const table = parseTables(md).find((t) => SB_COLS.every((c) => t.header.includes(c)));
  if (!table) return add('FAIL', 'storyboard', `找不到含七列的分镜表：${SB_COLS.join(' / ')}`);
  const col = Object.fromEntries(SB_COLS.map((c) => [c, table.header.indexOf(c)]));
  const fails = [], warns = [];
  const shots = [];
  const copySet = SPEC ? new Set(copyEntries().map((c) => norm(c.text))) : null;
  const EMPTY = /^(—|-|–|无|)$/;
  for (const r of table.rows) {
    const at = `L${r.line}`;
    if (r.cells.length !== table.header.length) { fails.push(`${at} 列数 ${r.cells.length} ≠ 表头 ${table.header.length}`); continue; }
    const c = (k) => r.cells[col[k]];
    for (const k of ['帧', '画面元素', '素材契约', '主体占比', '运动与转场']) if (EMPTY.test(c(k))) fails.push(`${at} 「${k}」为空`);
    const fr = c('帧').match(/^(\d+)\s*[–—~-]\s*(\d+)$/);
    if (!fr) fails.push(`${at} 帧必须写成"起–止"帧号，现在是「${c('帧')}」`);
    else shots.push({ at, from: +fr[1], to: +fr[2] });

    const asset = c('素材契约');
    if (!/纯代码|代码生成|程序化|3D 生成|无素材/.test(asset)) {
      if (!/\d+(\.\d+)?\s*:\s*\d+/.test(asset)) fails.push(`${at} 素材契约缺比例（标红，不许进 G3）`);
      if (!/\d+(\.\d+)?\s*fps/i.test(asset)) fails.push(`${at} 素材契约缺帧率（标红，不许进 G3）`);
    }

    const sub = c('主体占比');
    const pct = sub.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!pct && !/满画幅/.test(sub)) fails.push(`${at} 主体占比没写百分比`);
    else if (pct) {
      const v = +pct[1];
      const structured = /强结构|透视线|网格|对称轴|刻意留白/.test(sub);
      if (v < (RULES?.minSubjectPct ?? 8) && !structured) fails.push(`${at} 主体占比 ${v}% 且未声明强结构 / 刻意留白 → 判负`);
      else if (v < 15 && !structured) warns.push(`${at} 主体占比 ${v}%（8–15% 需要强结构分担视觉重量）`);
    }
    if (!/第\s*\d+\s*帧|帧即在|入画/.test(sub)) warns.push(`${at} 主体占比缺入画时刻`);

    if (copySet && !EMPTY.test(c('文案'))) {
      for (const line of c('文案').split(/<br\s*\/?>/i)) {
        const t = norm(line);
        if (t && !copySet.has(t)) fails.push(`${at} 文案「${line.trim()}」不在 spec.json 的 copy 里`);
      }
      if (EMPTY.test(c('文案时序'))) fails.push(`${at} 有文案但没写文案时序`);
    }
  }
  if (!table.rows.length) fails.push('分镜表没有镜头');
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].from !== shots[i - 1].to) warns.push(`${shots[i].at} 起始帧 ${shots[i].from} 与上一镜结束 ${shots[i - 1].to} 不连续`);
  }
  const lens = shots.map((s) => s.to - s.from);
  const same = lens.filter((l, i) => lens.indexOf(l) !== i).length;
  if (same) warns.push(`有 ${same + 1} 个镜头时长相同——按职能重量分配，不按字数`);
  const total = tokensSrc()?.match(/durationInFrames\s*:\s*(\d+)/)?.[1];
  if (total && shots.length && shots.at(-1).to !== +total) warns.push(`分镜末帧 ${shots.at(-1).to} ≠ tokens CANVAS.durationInFrames ${total}`);
  if (!/写作记录|为什么这么定/.test(md)) warns.push('分镜表下缺「写作记录」（每个决定一行理由）');

  if (fails.length) add('FAIL', 'storyboard', `${fails.length} 处不合格`, fails.slice(0, 20));
  else add('PASS', 'storyboard', `分镜 ${table.rows.length} 镜，七列齐全`);
  if (warns.length) add('WARN', 'storyboard', `${warns.length} 处提醒`, warns.slice(0, 12));
}

/* ================= G2 / G3 代码 ================= */
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'inherit', 'initial', 'unset']);
const CJK = '㐀-鿿豈-﫿';
function checkFonts() {
  const fonts = parseFonts();
  if (!fonts) return add('FAIL', 'fonts', '读不出 src/tokens.ts 的 FONTS（每项需 family + file 字面量）');
  const families = new Set(Object.values(fonts).map((f) => f.family));
  const all = srcFiles.map((f) => ({ f, s: stripComments(read(f)) }));

  if (!all.some(({ s }) => /new\s+FontFace\(/.test(s))) add('FAIL', 'fonts', '没有任何 new FontFace(...) 显式注册');
  if (!all.some(({ s }) => /document\.fonts\.check\(/.test(s))) add('FAIL', 'fonts', '缺少 document.fonts.check() 加载断言——字体没加载会静默回退，渲染照样成功');
  if (!all.some(({ s }) => /cancelRender\(/.test(s))) add('FAIL', 'fonts', '缺少 cancelRender——断言失败时必须让渲染失败');
  const inline = all.filter(({ s }) => /@font-face/.test(s)).map(({ f }) => rel(f));
  if (inline.length) add('FAIL', 'fonts', '出现 @font-face（解析时序竞态：同一条片子两次渲染一次对一次错）', inline);

  // 场景里直接写的字体族名，取字体栈第一项
  const unknown = [];
  for (const { f, s } of all) {
    for (const m of s.matchAll(/fontFamily\s*:\s*(['"`])([^'"`]+)\1/g)) {
      const first = m[2].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (!GENERIC.has(first) && !families.has(first)) unknown.push(`${first} ← ${rel(f)}`);
    }
  }
  if (unknown.length) add('FAIL', 'fonts', '使用了 FONTS 里没有登记的字体', unknown);

  // 字形覆盖：读 cmap
  if (!loadSpec()) return;
  const lacks = [];
  let checked = 0;
  for (const [key, list] of Object.entries(SPEC.copy)) {
    const font = fonts[key];
    if (!font) { lacks.push(`spec.copy.${key} 对应的字体不在 FONTS 里（键名必须一致）`); continue; }
    const file = P('public', font.file);
    if (!exists(file)) { lacks.push(`${font.family}：找不到 public/${font.file}`); continue; }
    let has;
    try { has = cmapLookup(file); } catch (e) { lacks.push(`${font.family}：${e.message}`); continue; }
    const text = (Array.isArray(list) ? list : []).map((c) => (typeof c === 'string' ? c : c.text)).join('');
    const chars = [...new Set([...text].filter((ch) => !/\s/.test(ch)))];
    const miss = chars.filter((ch) => !has(ch.codePointAt(0)));
    checked += chars.length;
    if (miss.length) lacks.push(`${font.family}（${font.file}）缺 ${miss.length} 字：${miss.join(' ')}`);
  }
  if (lacks.length) add('FAIL', 'glyph', '字形覆盖不全——缺的字会单独回退，一行混两种字体', lacks);
  else add('PASS', 'glyph', `cmap 实读：${Object.keys(SPEC.copy).length} 个字体覆盖全部 ${checked} 个字符`);

  // 代码里出现、但没登记进 spec.json 的中文文案（模板文案漏改的老坑）
  const corpus = copyEntries().map((c) => c.text).join('\n');
  const stray = [];
  const re = new RegExp(`[${CJK}][${CJK}，。！？、：；“”‘’《》…· \\tA-Za-z0-9]*`, 'g');
  for (const { f, s } of all) {
    if (infraFiles().has(rel(f))) continue;
    for (const m of s.matchAll(re)) {
      const t = m[0].trim();
      if (t && !corpus.includes(t)) stray.push(`${rel(f)}  「${t.slice(0, 24)}」`);
    }
  }
  if (stray.length) add('FAIL', 'copy', '代码里有未登记进 spec.json 的文案（不会被字形检查覆盖）', [...new Set(stray)].slice(0, 12));
  if (!lacks.length && !unknown.length) add('PASS', 'fonts', `${families.size} 个字体族已登记并注册`);
}

const NAMED = 'white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta|brown|gold|silver|navy|teal';
const HARD_PATTERNS = [
  { re: /#[0-9a-fA-F]{3,8}\b/, label: '色值' },
  { re: /\b(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\((?!\s*\$\{)/, label: '色值函数' },
  { re: new RegExp(`['"\`](${NAMED})['"\`]`), label: '颜色名' },
  { re: /fontSize\s*:\s*['"`]?\d/, label: '裸字号' },
  { re: /fontFamily\s*:\s*['"`]/, label: '字面量字体' },
  { re: /Easing\.(bezier\(\s*-?\.?\d|linear|ease\b|quad|cubic|sin|exp|circle|back|elastic|bounce|poly)/, label: '曲线' },
  { re: /cubic-bezier\(/, label: '曲线' },
  { re: /\b(damping|stiffness|mass)\s*:\s*\d/, label: '弹簧参数' },
];
// tokens / 字体加载器 / spec.tokenFiles 是允许出现字面量的基础设施文件
const infraFiles = () => new Set(['src/tokens.ts', 'src/fonts.ts', ...((SPEC && SPEC.tokenFiles) || [])].map((p) => path.normalize(p)));
function checkHardcoded() {
  const allowed = infraFiles();
  const hits = [];
  for (const f of srcFiles) {
    if (allowed.has(rel(f))) continue;
    stripComments(read(f)).split('\n').forEach((line, i) => {
      for (const p of HARD_PATTERNS) if (p.re.test(line)) hits.push(`${rel(f)}:${i + 1}  ${p.label}  ${line.trim().slice(0, 70)}`);
    });
  }
  if (hits.length) add('FAIL', 'hardcoded', `${hits.length} 处绕过 tokens 的硬编码（色值 / 字号 / 字体 / 曲线）`, hits.slice(0, 15));
  else add('PASS', 'hardcoded', '场景文件无硬编码色值 / 字号 / 字体 / 曲线');
}

/* ---------- 参考对照：写实 / 半写实档位 ---------- */
const meanRGB = (file) => {
  const r = ff(['-v', 'error', '-i', file, '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  const b = r.stdout;
  return b && b.length >= 3 ? { r: b[0], g: b[1], b: b[2] } : null;
};
function frameStats(input, pre = [], vf = '') {
  const r = ff([...pre, '-i', input, '-vf', `${vf}signalstats,metadata=mode=print:file=-`, '-an', '-f', 'null', '-']);
  const txt = (r.stdout || '') + (r.stderr || '');
  const get = (k) => {
    const all = [...txt.matchAll(new RegExp(`lavfi\\.signalstats\\.${k}=(\\d+\\.?\\d*)`, 'g'))];
    return all.length ? parseFloat(all.at(-1)[1]) : null;
  };
  return { yavg: get('YAVG'), satavg: get('SATAVG'), ylow: get('YLOW'), yhigh: get('YHIGH') };
}
function compareToReference() {
  if (!REF) return add('FAIL', 'ref', '--compare 需要同时给 --ref <参考图>');
  if (!ffmpeg()) return add('FAIL', 'ref', '找不到 ffmpeg，参考对照无法执行即不通过');
  const shot = path.resolve(PROJECT, COMPARE), ref = path.resolve(PROJECT, REF);
  for (const f of [shot, ref]) if (!exists(f)) return add('FAIL', 'ref', `找不到 ${rel(f)}`);
  const A = frameStats(ref), B = frameStats(shot);
  const AR = meanRGB(ref), BR = meanRGB(shot);
  const rg = (c) => (c && c.g ? c.r / c.g : null), bg = (c) => (c && c.g ? c.b / c.g : null);
  const rows = [
    ['平均亮度 YAVG', A.yavg, B.yavg, 12],
    ['平均饱和度 SATAVG', A.satavg, B.satavg, 15],
    ['动态范围 YHIGH-YLOW', A.yhigh != null ? A.yhigh - A.ylow : null, B.yhigh != null ? B.yhigh - B.ylow : null, 20],
    ['R/G 通道比', rg(AR), rg(BR), 0.12],
    ['B/G 通道比', bg(AR), bg(BR), 0.12],
  ];
  const detail = [];
  let bad = 0, measured = 0;
  for (const [name, a, b, tol] of rows) {
    if (a == null || b == null) { detail.push(`? ${name}: 测不出`); continue; }
    measured++;
    const d = b - a;
    const ok = Math.abs(d) <= tol;
    if (!ok) bad++;
    const k = tol < 1 ? 3 : 1;
    detail.push(`${ok ? '✓' : '✗'} ${name}: 参考 ${a.toFixed(k)} / 成品 ${b.toFixed(k)} / 偏差 ${d > 0 ? '+' : ''}${d.toFixed(k)}（容差 ±${tol}）`);
  }
  const out = P('out', 'compare.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ff(['-v', 'error', '-y', '-i', ref, '-i', shot, '-filter_complex',
    '[0:v]scale=960:-2[a];[1:v]scale=960:-2[b];[a][b]hstack=shortest=1', '-frames:v', '1', out]);
  if (measured < rows.length) add('FAIL', 'ref', `只测出 ${measured}/${rows.length} 项——测不出不等于对上了`, detail);
  else if (bad) add('FAIL', 'ref', `${bad} 项与参考偏差超容差 — 并排图 ${rel(out)}`, detail);
  else add('PASS', 'ref', `与参考五项均在容差内 — 并排图 ${rel(out)}`, detail);
}
function checkReferenceGate() {
  const tier = lookTier();
  if (!tier) return add('FAIL', 'look', 'tokens.ts 缺 LOOK.tier（写实 / 半写实 / 风格化 / 图形化 必须先定）');
  if (!REALISTIC.has(tier)) return add('PASS', 'look', `质感档位 ${tier}，无需参考图对照`);
  const ref = ['ref.jpg', 'ref.png', 'ref.webp'].map((n) => P('reference', n)).find(exists);
  if (!ref) return add('FAIL', 'look', `档位 ${tier} 必须先落参考图 reference/ref.jpg`);
  if (!COMPARE) add('FAIL', 'look', `档位 ${tier}：G2 必须带 --compare <封面帧> --ref ${rel(ref)}`);
}

/* ================= G4 节奏 ================= */
const countChars = (s) => (s.match(new RegExp(`[${CJK}]`, 'g')) || []).length + (s.match(/[A-Za-z0-9]+/g) || []).length;
function checkCopyLength() {
  if (!loadSpec()) return;
  const over = copyEntries().filter((c) => countChars(c.text) > (c.kind === 'subtitle' ? RULES.maxSubtitleChars : RULES.maxCopyChars));
  if (over.length) add('FAIL', 'copy', `${over.length} 条文案超长（中文按字、拉丁按词计）`, over.map((c) => `${c.kind === 'subtitle' ? '字幕' : '标题'} ${countChars(c.text)}：${c.text}`));
  else add('PASS', 'copy', `文案长度均在上限内（标题 ≤${RULES.maxCopyChars} / 字幕 ≤${RULES.maxSubtitleChars}）`);
}
function checkCuts() {
  const v = requireVideo('rhythm');
  if (!v || !loadSpec()) return;
  // 直接在成片上检测切点：与代码怎么写（Sequence / Series / TransitionSeries / 变量）无关
  const r = ff(['-i', v.file, '-vf', `select='gt(scene,${RULES.sceneThreshold})',showinfo`, '-an', '-f', 'null', '-']);
  if (r.status !== 0) return add('FAIL', 'rhythm', `切点检测失败：${(r.stderr || '').trim().slice(-160)}`);
  const cuts = [...(r.stderr || '').matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
  const bounds = [0, ...cuts, v.duration];
  const shots = bounds.slice(1).map((t, i) => ({ from: bounds[i], dur: t - bounds[i] }));
  const short = shots.filter((s) => s.dur < RULES.minShotSec && !inHold(s.from, s.from + s.dur));
  const fmt = (s) => `${s.from.toFixed(2)}s 起 ${s.dur.toFixed(2)}s`;
  if (short.length) add('FAIL', 'rhythm', `${short.length} 个镜头短于 ${RULES.minShotSec}s（${SPEC.platform}）`, short.map(fmt).slice(0, 10));
  else add('PASS', 'rhythm', `检测到 ${cuts.length} 个硬切，最短镜头 ${Math.min(...shots.map((s) => s.dur)).toFixed(2)}s`);
  if (!cuts.length && v.duration > 6) add('WARN', 'rhythm', `${v.duration.toFixed(1)}s 内未检测到硬切——全是软转场时可调低 rules.sceneThreshold 复查`);
  const tol = 2 / v.fps;
  const sameGroups = shots.filter((a, i) => shots.some((b, j) => j !== i && Math.abs(a.dur - b.dur) <= tol));
  if (shots.length > 2 && sameGroups.length > shots.length / 2) add('WARN', 'rhythm', `${sameGroups.length}/${shots.length} 个镜头时长几乎相同——节奏会变平，按职能重量重分`);
}
function checkDeadTime() {
  const v = requireVideo('deadtime');
  if (!v || !loadSpec()) return;
  const r = ff(['-i', v.file, '-vf', `freezedetect=n=-60dB:d=${RULES.freezeWarnSec}`, '-map', '0:v', '-f', 'null', '-']);
  const log = (r.stderr || '') + (r.stdout || '');
  const starts = [...log.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => +m[1]);
  const durs = [...log.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => +m[1]);
  // 定格持续到片尾时 ffmpeg 不输出 freeze_duration —— 恰恰是"末帧多挂 2 秒"的情形，必须补上
  const segs = starts.map((s, i) => ({ start: s, dur: durs[i] ?? v.duration - s }));
  const live = segs.filter((x) => x.dur >= RULES.freezeWarnSec && !inHold(x.start, x.start + x.dur));
  const exempt = segs.length - live.length;
  const fmt = live.map((x) => `${x.start.toFixed(2)}s 起静止 ${x.dur.toFixed(2)}s`);
  const severe = live.filter((x) => x.dur >= RULES.freezeFailSec);
  if (severe.length) add('FAIL', 'deadtime', `${severe.length} 段静止 ≥${RULES.freezeFailSec}s（刻意定格请登记进 spec.json holds）`, fmt.slice(0, 8));
  else if (live.length) add('WARN', 'deadtime', `${live.length} 段短静止`, fmt.slice(0, 8));
  else add('PASS', 'deadtime', `无未登记的静止段${exempt ? `（${exempt} 段在 holds 豁免内）` : ''}`);
}
function makeContactSheet() {
  const v = requireVideo('sheet');
  if (!v) return;
  const out = P('out', 'contact-sheet.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = ff(['-v', 'error', '-y', '-i', v.file, '-vf',
    `fps=9/${v.duration.toFixed(3)},scale=480:-2,tile=3x3:padding=6:margin=6:color=0x141414`, '-frames:v', '1', out]);
  if (r.status !== 0) return add('FAIL', 'sheet', `抽帧失败：${(r.stderr || '').trim().slice(0, 160)}`);
  add('HUMAN', 'sheet', `九宫格 ${rel(out)} — 结束本轮，请用户判三条后放行`, [
    '1) 任一格主体 <8% 且画面无结构 → 该镜头判负',
    '2) 相邻两格几乎一样 → 节奏停滞',
    '3) 九格没有一格能单独当封面 → 缺强画面，重做分镜',
  ]);
}
function makeZoom() {
  const v = requireVideo('zoom');
  if (!v) return;
  const t = ZOOM_T && !isNaN(+ZOOM_T) ? ZOOM_T : (v.duration / 3).toFixed(2);
  const made = [];
  for (const [name, crop] of [['tl', 'crop=iw/2:ih/2:0:0'], ['tr', 'crop=iw/2:ih/2:iw/2:0'], ['bl', 'crop=iw/2:ih/2:0:ih/2'], ['br', 'crop=iw/2:ih/2:iw/2:ih/2']]) {
    const out = P('out', `zoom-${name}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (ff(['-v', 'error', '-y', '-ss', String(t), '-i', v.file, '-vf', crop, '-frames:v', '1', out]).status === 0) made.push(rel(out));
  }
  if (made.length !== 4) return add('FAIL', 'zoom', `放大图生成不完整（${made.length}/4）`);
  add('HUMAN', 'zoom', `4 张 100% 裁切图（t=${t}s）— 找"能画出边界的纯色块"`, [...made, '找到一块 = 一个未处理区域（天空之外）']);
}

/* ================= G5 终检 ================= */
function checkEnds() {
  const v = requireVideo('ends');
  if (!v) return;
  const first = frameStats(v.file, [], 'select=eq(n\\,0),');
  const last = frameStats(v.file, ['-sseof', '-0.3'], '');
  if (first.yhigh == null || last.yhigh == null) return add('FAIL', 'ends', '读不出首 / 末帧统计');
  const flat = (s) => s.yhigh - s.ylow < 8;
  if (flat(first)) add('FAIL', 'ends', `首帧近乎单色（YLOW ${first.ylow} / YHIGH ${first.yhigh}）——首帧即信息`);
  else add('PASS', 'ends', '首帧有内容');
  if (flat(last) && last.yavg < 24) add('FAIL', 'ends', '末帧是黑屏——尾板要完整，不是黑屏多挂几秒');
  else add('PASS', 'ends', '末帧不是黑屏');
}
function checkDelivery() {
  const f = P('delivery.md');
  if (!exists(f)) return add('FAIL', 'delivery', '缺少 delivery.md');
  const s = read(f);
  const need = [['画布参数', /画布|分辨率|\d{3,4}\s*[×x]\s*\d{3,4}/], ['素材来源与授权', /授权|license/i], ['字体清单', /字体/], ['已知限制', /限制|已知问题/], ['Remotion 授权', /Remotion/]];
  const miss = need.filter(([, re]) => !re.test(s)).map(([k]) => k);
  if (miss.length) add('FAIL', 'delivery', `delivery.md 缺：${miss.join('、')}`);
  else add('PASS', 'delivery', 'delivery.md 五项齐全');
  if (REALISTIC.has(lookTier()) && !exists(P('out', 'compare.png'))) add('FAIL', 'delivery', '写实档位必须附 out/compare.png（参考与成品并排）');
}

/* ================= 调度 ================= */
const ran = new Set();
const once = (k, fn) => { if (!ran.has(k)) { ran.add(k); fn(); } };
for (const s of stages) {
  if (s === 'g1') { once('spec', loadSpec); once('brief', checkBrief); once('storyboard', checkStoryboard); }
  if (s === 'g2' || s === 'g3') { once('spec', loadSpec); once('fonts', checkFonts); once('hardcoded', checkHardcoded); }
  if (s === 'g2') once('look', checkReferenceGate);
  if (s === 'g4' || s === 'g5') { once('spec', loadSpec); once('copylen', checkCopyLength); once('rhythm', checkCuts); once('deadtime', checkDeadTime); }
  if (s === 'g4') { if (SHEET) once('sheet', makeContactSheet); if (ZOOM) once('zoom', makeZoom); }
  if (s === 'g5') { once('ends', checkEnds); once('delivery', checkDelivery); }
}
if (COMPARE) compareToReference();

const icon = { PASS: '✓', WARN: '!', FAIL: '✗', HUMAN: '?' };
console.log(`\n[assert v${VERSION}] ${rel(PROJECT)}  stage=${stages.join(',') || '-'}${COMPARE ? ' +compare' : ''}\n`);
for (const r of results) {
  console.log(`  ${icon[r.level]} ${r.name.padEnd(10)} ${r.msg}`);
  for (const d of r.detail) console.log(`      ${d}`);
}
const fails = results.filter((r) => r.level === 'FAIL').length;
const human = results.filter((r) => r.level === 'HUMAN').length;
console.log(`\n[assert] ${fails ? `FAIL ×${fails}` : 'PASS'}${human ? `  · 需人眼判断 ×${human}：结束本轮，等用户放行` : ''}\n`);
process.exit(fails ? 1 : 0);
