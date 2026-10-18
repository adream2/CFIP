/** 测试辅助：构造合成 ip2region xdb 文件（v4 格式） */

export function buildSyntheticXdb(): ArrayBuffer {
  const HEADER = 256;
  const VEC = 256 * 256 * 8;
  const regionA = '中国|测试省|测试市|测试运营商|CN';
  const regionB = 'United States|California|0|Google LLC|US';
  const bytesA = new TextEncoder().encode(regionA);
  const bytesB = new TextEncoder().encode(regionB);

  const idxStart = HEADER + VEC;
  const dataStart = idxStart + 28;
  const total = dataStart + bytesA.length + bytesB.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  view.setUint16(0, 3, true); // structure 3.0
  view.setUint16(2, 1, true); // indexPolicy: vector
  view.setUint32(4, 0x64c00000, true); // createdAt
  view.setUint32(8, idxStart, true); // startIndexPtr
  view.setUint32(12, idxStart + 28, true); // endIndexPtr
  view.setUint16(16, 4, true); // ipVersion: IPv4
  view.setUint16(18, 4, true); // runtimePtrBytes

  const putEntry = (offset: number, startIp: number[], endIp: number[], dataPtr: number, dataLen: number) => {
    view.setUint32(offset, ((startIp[0] << 24) | (startIp[1] << 16) | (startIp[2] << 8) | startIp[3]) >>> 0, true);
    view.setUint32(offset + 4, ((endIp[0] << 24) | (endIp[1] << 16) | (endIp[2] << 8) | endIp[3]) >>> 0, true);
    view.setUint16(offset + 8, dataLen, true);
    view.setUint32(offset + 10, dataPtr, true);
  };

  putEntry(idxStart, [1, 2, 0, 0], [1, 2, 255, 255], dataStart, bytesA.length);
  putEntry(idxStart + 14, [8, 8, 8, 0], [8, 8, 8, 255], dataStart + bytesA.length, bytesB.length);

  const vA = HEADER + 1 * 2048 + 2 * 8;
  view.setUint32(vA, idxStart, true);
  view.setUint32(vA + 4, idxStart + 14, true);
  const vB = HEADER + 8 * 2048 + 8 * 8;
  view.setUint32(vB, idxStart + 14, true);
  view.setUint32(vB + 4, idxStart + 28, true);

  bytes.set(bytesA, dataStart);
  bytes.set(bytesB, dataStart + bytesA.length);
  return buf;
}

export const SYNTH_REGION_A = '中国|测试省|测试市|测试运营商|CN';
export const SYNTH_REGION_B = 'United States|California|0|Google LLC|US';
