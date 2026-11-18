#!/usr/bin/env node
// 转发器。门禁脚本全世界只有一份，在 skill 目录的 scripts/assert.mjs。
// 项目里不放拷贝——拷贝会过期，过期的门禁比没有门禁更危险。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NAME = 'remotion-video-producer';
const home = os.homedir();
const dirs = [
  process.env.VIDEO_SKILL_DIR,
  path.join(home, '.claude', 'skills', NAME),
  path.join(home, '.skills-manager', 'skills', NAME),
  path.join(home, '.codex', 'skills', NAME),
  path.join(home, '.agents', 'skills', NAME),
].filter(Boolean);

const hit = dirs.map((d) => path.join(d, 'scripts', 'assert.mjs')).find((f) => fs.existsSync(f));
if (!hit) {
  console.error(`[assert] 找不到 skill 的门禁脚本。设置 VIDEO_SKILL_DIR=<${NAME} 目录> 后重试。\n  已找过：\n  ${dirs.join('\n  ')}`);
  process.exit(2);
}
await import(pathToFileURL(hit).href);
