/**
 * ip2region xdb 二进制查询器（自实现精简版，无依赖）。
 * 格式规范来自 lionsoul2014/ip2region binding/javascript：
 *   - Header: 256 字节
 *       @0  version        uint16 LE（2=旧版仅 IPv4；3=支持 IPv6）
 *       @2  indexPolicy    uint16 LE
 *       @4  createdAt      uint32 LE
 *       @8  startIndexPtr  uint32 LE
 *       @12 endIndexPtr    uint32 LE
 *       @16 ipVersion      uint16 LE（4 / 6）
 *       @18 runtimePtrBytes uint16 LE
 *   - VectorIndex: 256×256×8 字节，位于 Header 之后
 *       条目 offset = il0*2048 + il1*8，内含 sPtr/ePtr（uint32 LE，索引块字节偏移）
 *   - Index 块条目: IPv4 14 字节 = startIp(4 LE) + endIp(4 LE) + dataLen(2 LE) + dataPtr(4 LE)
 *                 IPv6 38 字节 = startIp(16) + endIp(16) + dataLen(2 LE) + dataPtr(4 LE)
 *   - dataPtr 处为 dataLen 字节的 UTF-8 region 字符串
 */

import { ipToBytes } from '../ip';

const HEADER_LEN = 256;
const VECTOR_COLS = 256;
const VECTOR_SIZE = 8;
const IDX_V4 = 14;
const IDX_V6 = 38;

export interface RegionInfo {
  country: string;
  province: string;
  city: string;
  isp: string;
  iso: string;
  raw: string;
}

/** 解析 region 字符串。兼容新旧两种字段排列（以真实数据为准，见 test）。 */
export function parseRegion(raw: string): RegionInfo {
  const f = raw.split('|').map((s) => s.trim());
  if (f.length === 5 && /^[A-Za-z]{2}$/.test(f[4])) {
    // Country|Province|City|ISP|ISO
    return { country: f[0], province: f[1], city: f[2], isp: f[3], iso: f[4].toUpperCase(), raw };
  }
  if (f.length === 5) {
    // 旧格式 Country|Region|Province|City|ISP
    return { country: f[0], province: f[2], city: f[3], isp: f[4], iso: '', raw };
  }
  if (f.length === 4) {
    return { country: f[0], province: f[1], city: f[2], isp: f[3], iso: '', raw };
  }
  return { country: f[0] ?? '', province: '', city: '', isp: '', iso: '', raw };
}

export class XdbSearcher {
  readonly ipVersion: 4 | 6;
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private readonly indexSize: number;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    if (buffer.byteLength < HEADER_LEN) throw new Error('xdb buffer too small');
    const structure = this.view.getUint16(0, true);
    if (structure === 2) {
      this.ipVersion = 4;
    } else if (structure === 3) {
      this.ipVersion = this.view.getUint16(16, true) === 6 ? 6 : 4;
    } else {
      throw new Error(`unsupported xdb structure version: ${structure}`);
    }
    this.indexSize = this.ipVersion === 4 ? IDX_V4 : IDX_V6;
  }

  /** 查询 region 字符串；未命中返回空串 */
  search(ip: string): string {
    const ipBytes = ipToBytes(ip);
    if (ipBytes.length !== (this.ipVersion === 4 ? 4 : 16)) {
      throw new Error(`ip version mismatch: ${ip} vs xdb v${this.ipVersion}`);
    }
    const il0 = ipBytes[0];
    const il1 = ipBytes[1];
    const vidx = HEADER_LEN + il0 * VECTOR_COLS * VECTOR_SIZE + il1 * VECTOR_SIZE;
    if (vidx + VECTOR_SIZE > this.bytes.length) return '';
    const sPtr = this.view.getUint32(vidx, true);
    const ePtr = this.view.getUint32(vidx + 4, true);
    if (sPtr === 0 || ePtr === 0) return ''; // 无数据段

    const n = ipBytes.length;
    let l = 0;
    let h = Math.floor((ePtr - sPtr) / this.indexSize);
    let dLen = 0;
    let dPtr = 0;
    while (l <= h) {
      const m = (l + h) >> 1;
      const p = sPtr + m * this.indexSize;
      if (p + this.indexSize > this.bytes.length) break;
      if (this.compareIp(ipBytes, p) < 0) {
        h = m - 1;
        continue;
      }
      if (this.compareIp(ipBytes, p + n) > 0) {
        l = m + 1;
        continue;
      }
      dLen = this.view.getUint16(p + n * 2, true);
      dPtr = this.view.getUint32(p + n * 2 + 2, true);
      break;
    }
    if (dLen === 0 || dPtr + dLen > this.bytes.length) return '';
    return new TextDecoder().decode(this.bytes.subarray(dPtr, dPtr + dLen));
  }

  /** 比较 IP 与索引条目中 offset 处的边界 IP；IPv4 条目为小端 uint32 */
  private compareIp(ipBytes: Uint8Array, offset: number): number {
    if (this.ipVersion === 4) {
      const stored = this.view.getUint32(offset, true) >>> 0;
      const query = (((ipBytes[0] << 24) | (ipBytes[1] << 16) | (ipBytes[2] << 8) | ipBytes[3]) >>> 0);
      return query < stored ? -1 : query > stored ? 1 : 0;
    }
    for (let i = 0; i < 16; i++) {
      const a = ipBytes[i];
      const b = this.bytes[offset + i];
      if (a !== b) return a < b ? -1 : 1;
    }
    return 0;
  }
}
