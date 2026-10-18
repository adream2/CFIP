#!/usr/bin/env node
/**
 * 一次性脚本：下载 ip2region xdb 数据并上传到 Cloudflare KV。
 *
 * 用法：
 *   node scripts/upload-xdb.mjs            # v4 + v6 都尝试
 *   node scripts/upload-xdb.mjs v4         # 仅 v4
 *
 * 依赖：wrangler 已登录（npx wrangler login），且 wrangler.toml 中
 * CFIP_KV namespace id 已正确配置。
 *
 * 说明：
 *   - v4 数据约 11MB，国内中文归属的核心数据源，必传
 *   - v6 数据体积超出公共 CDN 单文件限制时可能下载失败，失败不影响 v4
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const WRANGLER = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');

/** 按优先级排列的下载源（jsdelivr 可达性最好；raw.githubusercontent 为官方源） */
const SOURCES = (version) => [
  `https://cdn.jsdelivr.net/gh/lionsoul2014/ip2region@master/data/ip2region_${version}.xdb`,
  `https://raw.githubusercontent.com/lionsoul2014/ip2region/master/data/ip2region_${version}.xdb`,
];

const KV_KEYS = { v4: 'xdb:ip2region_v4', v6: 'xdb:ip2region_v6' };
const KV_BINDING = 'CFIP_KV';

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error('empty body');
  await pipeline(res.body, createWriteStream(dest));
  const { size } = await stat(dest);
  if (size < 1024) throw new Error(`suspicious file size: ${size} bytes`);
  return size;
}

async function upload(version) {
  const file = join(DATA_DIR, `ip2region_${version}.xdb`);
  let ok = false;
  for (const url of SOURCES(version)) {
    try {
      console.log(`[${version}] 下载 ${url}`);
      const size = await download(url, file);
      console.log(`[${version}] 下载完成：${(size / 1024 / 1024).toFixed(2)} MB`);
      ok = true;
      break;
    } catch (e) {
      console.warn(`[${version}] 源失败：${e.message}`);
    }
  }
  if (!ok) {
    console.warn(`[${version}] 所有源下载失败，跳过（v4 为必需，v6 为可选）`);
    return false;
  }

  console.log(`[${version}] 上传到 KV（${KV_BINDING} / ${KV_KEYS[version]}）…`);
  execFileSync(WRANGLER, [
    'kv', 'key', 'put',
    '--binding', KV_BINDING,
    KV_KEYS[version],
    '--path', file,
  ], { stdio: 'inherit', cwd: ROOT });
  console.log(`[${version}] 上传完成`);
  return true;
}

async function main() {
  const only = process.argv[2]; // 'v4' | 'v6' | undefined
  await mkdir(DATA_DIR, { recursive: true });

  const versions = only ? [only.replace(/^ip2region_/, '')] : ['v4', 'v6'];
  const results = {};
  for (const v of versions) {
    if (!['v4', 'v6'].includes(v)) {
      console.error(`未知版本参数: ${v}（应为 v4 或 v6）`);
      process.exit(1);
    }
    results[v] = await upload(v);
  }

  // 清理本地副本（数据以 KV 为准）
  await rm(DATA_DIR, { recursive: true, force: true });

  if (results.v4 === false && !only) {
    console.error('\nv4 数据上传失败——国内中文归属将不可用。请检查网络后重试。');
    process.exit(1);
  }
  console.log('\n完成。部署：npx wrangler deploy');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
