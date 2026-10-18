// 临时验证脚本：用真实 v4 xdb 验证查询算法与 region 字符串格式
import { readFileSync } from 'node:fs';

const buf = readFileSync('C:/Users/adrea/Desktop/CFIP/data/ip2region_v4.xdb');
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

const structure = view.getUint16(0, true);
const startIndexPtr = view.getUint32(8, true);
const endIndexPtr = view.getUint32(12, true);
const ipVersion = view.getUint16(16, true);
console.log('header:', { structure, startIndexPtr, endIndexPtr, ipVersion, size: buf.byteLength });

function ipToBytes(ip) {
  return new Uint8Array(ip.split('.').map(Number));
}

function search(ip) {
  const ipBytes = ipToBytes(ip);
  const il0 = ipBytes[0], il1 = ipBytes[1];
  const vidx = 256 + il0 * 2048 + il1 * 8;
  const sPtr = view.getUint32(vidx, true);
  const ePtr = view.getUint32(vidx + 4, true);
  if (sPtr === 0 || ePtr === 0) return '(no segment)';
  let l = 0, h = Math.floor((ePtr - sPtr) / 14);
  let dLen = 0, dPtr = 0;
  while (l <= h) {
    const m = (l + h) >> 1;
    const p = sPtr + m * 14;
    const storedStart = view.getUint32(p, true) >>> 0;
    const q = ((ipBytes[0] << 24) | (ipBytes[1] << 16) | (ipBytes[2] << 8) | ipBytes[3]) >>> 0;
    if (q < storedStart) { h = m - 1; continue; }
    const storedEnd = view.getUint32(p + 4, true) >>> 0;
    if (q > storedEnd) { l = m + 1; continue; }
    dLen = view.getUint16(p + 8, true);
    dPtr = view.getUint32(p + 10, true);
    break;
  }
  if (dLen === 0) return '(empty)';
  return new TextDecoder().decode(bytes.subarray(dPtr, dPtr + dLen));
}

for (const ip of ['8.8.8.8', '114.114.114.114', '1.1.1.1', '223.104.60.60', '61.135.169.121', '180.163.31.145', '104.16.0.1', '203.0.113.9', '256.256.256.256']) {
  console.log(ip, '=>', JSON.stringify(search(ip)));
}
