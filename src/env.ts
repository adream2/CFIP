/** 手动维护的环境绑定类型（与 wrangler.toml 对应） */

export interface Env {
  ASSETS: Fetcher;
  CFIP_KV: KVNamespace;

  // vars
  CACHE_TTL_SEC?: string;
  DNSBL_TTL_SEC?: string;
  ENABLE_IPAPI?: string;
  UPSTREAM_TIMEOUT_MS?: string;

  // secrets（可选数据源，缺失时对应适配器不注册）
  IPINFO_TOKEN?: string;
  ABUSEIPDB_KEY?: string;
}
