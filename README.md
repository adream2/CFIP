# CFIP · IP 地址详细信息查询工具

[![CI](https://github.com/adream2/CFIP/actions/workflows/ci.yml/badge.svg)](https://github.com/adream2/CFIP/actions/workflows/ci.yml)
[![Deploy](https://github.com/adream2/CFIP/actions/workflows/deploy.yml/badge.svg)](https://github.com/adream2/CFIP/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

基于 **Cloudflare Workers** 的 IP 详情查询服务：输入任意 IPv4/IPv6（或留空查询本机 IP），一次返回尽可能全面的信息——归属地（国家/省/市/邮编/经纬度/时区）、运营商（ISP/ORG）、ASN、节点归属（云厂商/CDN 识别、托管 vs 住宅、Anycast）、反向解析（rDNS）、DNSBL 黑名单、代理/VPN/Tor 识别、注册局信息（RDAP 网段/滥用邮箱）等。

- 零密钥可用：所有默认数据源均无需 API Key
- 多源聚合 + 字段级优先级合并 + 单源熔断降级 + 多源位置对比
- 内置工具箱：出口探测 / 域名工具箱 / 全球 Ping / 服务状态（借鉴 one-ip，零 Key）
- 前端零外部请求：内联 SVG 地图、localStorage 查询历史、无 CDN 无统计脚本
- 6 小时结果缓存（Cache API），共享出口限流友好
- 隐私：不记录查询日志、不建查询数据库，仅缓存

## 界面与 API

| 端点 | 说明 |
| --- | --- |
| `/` | 浏览器 → 中文单页；命令行（curl/wget） → 纯文本摘要 |
| `/api[?ip=]` | 统一 JSON（CORS 全开） |
| `/ip[?ip=]` | 纯文本 IP 地址（脚本友好） |
| `/api/probe` | 出口探测：各 AI/云服务视角的 Worker 出口 IP 与可达性 |
| `/api/domain?domain=` | 域名工具箱：DoH 解析 + CDN 识别 + RDAP WHOIS |
| `/api/ping?target=&type=` | 全球 Ping（Globalping，ping/http/dns，匿名 250 次/h） |
| `/api/status` | 服务状态聚合（Cloudflare/GitHub/OpenAI/Anthropic） |
| `?ip=example.com` | *（规划中）域名先经 DoH 解析再查询 |

```bash
curl https://<your-worker>.workers.dev/api?ip=8.8.8.8
curl https://<your-worker>.workers.dev/ip
curl -s https://<your-worker>.workers.dev/api/probe | head -30   # 出口探测
curl -s https://<your-worker>.workers.dev/api/domain?domain=github.com | head -30
curl -s https://<your-worker>.workers.dev | head -20   # 纯文本摘要
```

JSON 按分区组织：`location` / `network` / `node` / `reputation` / `connection`（仅自身查询）/ `comparison`（多源位置对比）/ `meta`（数据源状态、耗时、warnings）。判定类字段（如 `node.hosting`）带 `confidence` 与 `source`，标注推断强度。

## 数据源

| 来源 | 提供 | Key | 限流 | 失败行为 |
| --- | --- | --- | --- | --- |
| `request.cf` | 连接层信息（HTTP/TLS/RTT/colo，仅自身查询） | 否 | 无 | 字段级防御读取 |
| ipwho.is（主） | 地理全套、ASN/ISP/ORG、代理识别、托管识别 | 否 | 1000/天 | 降级 ip-api |
| ip-api.com（二级） | 地理、ISP/ORG/AS、移动/托管/代理、rDNS 兜底 | 否 | 45/分钟 | `ENABLE_IPAPI=false` 可关 |
| ip2region 离线库 | **国内中文省/市/运营商**（xdb 随 Workers Assets 部署，仅 IPv4） | 否 | 无 | 缺数据时 warning，中文归属退化为在线源 |
| RDAP（rdap.org 引导） | 网段 CIDR、RIR、注册时间、滥用投诉邮箱、用途类型 | 否 | 无 | network 段留空 |
| Cloudflare DoH | rDNS 反解、5 个 DNSBL 黑名单（含命中原因 TXT）、域名解析 | 否 | 无 | rdnsError / 空记录 |
| bgp.tools | ASN 名称/描述/注册国家（已知 ASN 时触发） | 否 | 无 | 忽略 |
| Globalping | 全球分布式探针（ping/http/dns 测量，`/api/ping`） | 否 | 匿名 250 次/h | 429 时提示稍后再试 |
| Statuspage（CF/GH/OpenAI/Anthropic） | 服务状态聚合（`/api/status`） | 否 | 无 | 字段置空 |
| ipinfo.io（可选） | 加强地理/代理识别 | `IPINFO_TOKEN` | 5 万/月 | 无 secret 不注册 |
| AbuseIPDB（可选） | 滥用评分/举报数 | `ABUSEIPDB_KEY` | 1000/天 | 无 secret 不注册 |

> **关于共享出口限流**：Worker 出站请求对上游显示的是 Cloudflare 共享出口 IP，ipwho.is / ip-api 的配额可能被多方共用。缓解：6h 缓存 + 多源降级链 + 连续失败熔断（60s 跳过窗口）+ 无限制骨干源（RDAP/DoH/bgp.tools）。
>
> **ip-api.com 免费档禁止商业用途**，本项目仅将其作为二级降级源并保留 attribution；商业用途请购买其 Pro 或设 `ENABLE_IPAPI=false`。

## 部署

### 1. 克隆与安装

```bash
git clone https://github.com/adream2/CFIP.git && cd CFIP
npm install
```

### 2. 国内归属数据（ip2region，零配置）

`public/data/ip2region_v4.xdb`（约 11MB）作为 Workers Assets **随代码一起部署**，Worker 经 ASSETS 绑定按需加载（模块级记忆化，每 isolate 一次）——无需 KV、无需手动上传。更新数据：

```bash
GH_TOKEN=<有 Contents 写权限的 PAT> npm run xdb:sync
```

> Workers Assets 单文件上限 25 MiB（Free 同等待遇），11MB 的 xdb 放得正好。IPv6 离线数据（v6 xdb）因体积超出公共 CDN 单文件限制未内置；IPv6 查询的地理/网络/信誉数据由在线源完整覆盖，功能不受影响。

### 3. 本地验证

```bash
npx wrangler dev
curl "http://localhost:8787/api?ip=114.114.114.114"
curl "http://localhost:8787/api/probe"
npm test          # 122 个测试（ip/merge/xdb/render/tools/adapters/handler 集成）
```

### 4. 部署

```bash
npx wrangler deploy
```

或推送 GitHub 自动部署（见下）。

### 5. GitHub Actions 自动部署

1. 建仓库并推送代码
2. Cloudflare Dashboard → My Profile → API Tokens → 创建令牌，权限选 **Account.Workers Scripts:Edit**（最小化）
3. 仓库 Settings → Secrets → 添加 `CF_API_TOKEN`
4. push 到 `main` 即自动：类型检查 → 测试 → `wrangler deploy`

可选 secrets：`IPINFO_TOKEN`、`ABUSEIPDB_KEY`（配置后在 `deploy.yml` 取消注释对应段落，或手动 `npx wrangler secret put <NAME>`）。

## 配置项（wrangler.toml `[vars]`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CACHE_TTL_SEC` | `21600` | 查询结果缓存（6h） |
| `DNSBL_TTL_SEC` | `3600` | 黑名单缓存（1h，变化快） |
| `ENABLE_IPAPI` | `true` | ip-api.com 降级源开关 |
| `UPSTREAM_TIMEOUT_MS` | `6000` | 单源超时 |

## 架构

```
请求 → 路由(/api | /ip | /api/probe | /api/domain | /api/ping | /api/status
              | / + UA 协商 | ASSETS)
  → parseIp 校验/规范化 → classifyIp（非公网短路，零外部请求）
  → Cache API 读取（仅显式 ?ip=；过半衰期后台刷新）
  → 并行适配器（Promise.allSettled + 每源超时 + 熔断）
  → bgptools 条件追加轮（已知 ASN 时）
  → mergeResults 字段级优先级合并（priorities.ts）
  → 静态 ASN 映射兜底（provider-map.ts：云厂商/CDN/anycast）
  → comparison 多源位置对比 → 写缓存 → 响应（JSON / 文本 / HTML）
```

```
src/
├── index.ts            # Worker 入口：路由、编排、缓存、响应协商
├── types.ts            # 统一 IpInfo schema
├── ip.ts               # IP 解析/分类/ARPA（纯函数）
├── merge.ts            # 字段级优先级合并器
├── cache.ts            # Cache API 封装
├── respond.ts          # JSON/文本协商、UA 判定
├── config.ts           # 环境变量默认值
├── adapters/           # 9 个数据源适配器 + 注册/执行 + 优先级表 + 熔断
├── tools/              # 工具端点：probe（出口探测）/ domain（DNS+RDAP+CDN）
│                       #   ping（Globalping）/ status（状态聚合）/ cache（TTL 缓存）
└── xdb/searcher.ts     # ip2region xdb 二进制查询（自实现）
public/                 # Workers Assets：单页 + 原生 JS + CSS + data/ip2region_v4.xdb
scripts/sync-xdb.mjs    # xdb 数据同步（下载 → Contents API 推送进仓库，随资产部署）
test/                   # Vitest（@cloudflare/vitest-pool-workers）
```

## 字体（钉钉进步体）

CSS 已预留 `@font-face`（`public/assets/fonts/DingTalk-JinBuTi-CN-subset.woff2`）。请自行获取字体并子集化后放入该路径：

1. 钉钉进步体对个人/企业免费商用（以[官方说明](https://www.dingtalk.com/)为准，请存档许可证）
2. 子集化常用 3500 汉字控制在 1–2MB（如 `fonttools pyftsubset --unicodes="U+4E00-9FFF,..."`）
3. 未放置字体时自动回退系统字体栈（PingFang SC / Microsoft YaHei / Noto Sans SC），功能与排版不受影响

## 设计参考

- [zhihui-hu/one-ip](https://github.com/zhihui-hu/one-ip) — 一站式 IP 工具箱（功能矩阵参考：出口探测/域名工具/全球 Ping/服务状态）
- [jinhuaitao/My-IP](https://github.com/jinhuaitao/My-IP) — Worker IP 信息页（UA 协商、端点设计）
- [Adgerlee/CF-IPInfo](https://github.com/Adgerlee/CF-IPInfo) — 仪表盘与多语言
- [slchris/iptools](https://github.com/slchris/iptools) — wrangler 工程布局
- [v1xingyue/geo-sdk-worker](https://github.com/qixingyue/geo-sdk-worker) — TS + Vitest + Assets
- [yack-security/CFWorker_PublicIP](https://github.com/yack-security/CFWorker_PublicIP) — ip-api + DoH
- [lionsoul2014/ip2region](https://github.com/lionsoul2014/ip2region) — 离线中文 IP 数据

## 已知限制

- ip2region 仅 IPv4（见上）；「住宅宽带 vs 托管」无权威免费源，`isBroadband` 明确标注为推断
- Cloudflare 平台侧的标准请求日志不受应用控制；应用侧本身零日志零存储
- IP 地理定位精度取决于数据源，城市级为行业常态；DNSBL 逐列表独立展示，不下单一结论
- 出口探测反映的是 **Worker 共享出口**在服务方的视角，不代表访客本机网络；Globalping 匿名额度按出口 IP 共享，高峰期可能触发 429

## License

MIT
