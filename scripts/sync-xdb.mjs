#!/usr/bin/env node
/**
 * ip2region xdb 数据同步：下载最新 v4 数据并推送到 GitHub 仓库的
 * public/data/ip2region_v4.xdb（作为 Workers Assets 随代码部署，无需 KV）。
 *
 * 用法：
 *   GH_TOKEN=<GitHub PAT，Contents 写权限> node scripts/sync-xdb.mjs [owner/repo]
 *   GH_TOKEN=... node scripts/sync-xdb.mjs adream2/CFIP
 *
 * 说明：
 *   - v4 数据约 11MB，是国内中文归属（省/市/运营商）的核心数据源
 *   - 推送后 push 到 main 即随下次部署生效；也可以先本地 npx wrangler dev 验证
 *   - v6 数据体积超出公共 CDN 单文件限制，未内置；IPv6 归属以在线数据源为准
 */

import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const TARGET_PATH = 'public/data/ip2region_v4.xdb';

/** 按优先级排列的下载源（jsdelivr 可达性最好；raw.githubusercontent 为官方源） */
const SOURCES = [
  'https://cdn.jsdelivr.net/gh/lionsoul2014/ip2region@master/data/ip2region_v4.xdb',
  'https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_v4.xdb',
];

const REPO = process.argv[2] ?? process.env.GH_REPO ?? 'adream2/CFIP';
const TOKEN = process.env.GH_TOKEN;

function fail(msg) {
  console.error(`[sync-xdb] ${msg}`);
  process.exit(1);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error('empty body');
  await pipeline(res.body, createWriteStream(dest));
  const { size } = await stat(dest);
  if (size < 1024) throw new Error(`suspicious file size: ${size} bytes`);
  return size;
}

async function main() {
  if (!TOKEN) fail('缺少 GH_TOKEN 环境变量（需要对仓库有 Contents 写权限的 PAT）');
  if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) fail(`仓库名格式错误: ${REPO}（应为 owner/repo）`);

  await mkdir(DATA_DIR, { recursive: true });
  const file = join(DATA_DIR, 'ip2region_v4.xdb');

  let ok = false;
  for (const url of SOURCES) {
    try {
      console.log(`[sync-xdb] 下载 ${url}`);
      const size = await download(url, file);
      console.log(`[sync-xdb] 下载完成：${(size / 1024 / 1024).toFixed(2)} MB`);
      ok = true;
      break;
    } catch (e) {
      console.warn(`[sync-xdb] 源失败：${e.message}`);
    }
  }
  if (!ok) fail('所有源下载失败');

  const api = `https://api.github.com/repos/${REPO}/contents/${TARGET_PATH}`;
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cfip-sync-xdb',
  };

  // 已存在则取 SHA（更新必需）
  let sha;
  const cur = await fetch(api, { headers });
  if (cur.status === 200) {
    sha = (await cur.json()).sha;
    console.log('[sync-xdb] 远端已存在该文件，将执行更新');
  } else if (cur.status !== 404) {
    fail(`查询远端文件失败：HTTP ${cur.status}`);
  }

  const content = (await readFile(file)).toString('base64');
  console.log(`[sync-xdb] 推送到 ${REPO}/${TARGET_PATH}（base64 ${(content.length / 1024 / 1024).toFixed(1)} MB）…`);
  const put = await fetch(api, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'chore(data): 同步 ip2region v4 xdb（scripts/sync-xdb.mjs）',
      content,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!put.ok) {
    const body = await put.text();
    fail(`推送失败：HTTP ${put.status} ${body.slice(0, 300)}`);
  }
  const j = await put.json();
  console.log(`[sync-xdb] 完成：${j.commit?.html_url ?? '(已提交)'}`);

  // 清理本地下载副本（正式副本在 public/data/，由 git 管理）
  await rm(DATA_DIR, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
