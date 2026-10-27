/** 手动维护的环境绑定类型（与 wrangler.toml 对应） */

export interface Env {
  ASSETS: Fetcher;

  // vars
  CACHE_TTL_SEC?: string;
  DNSBL_TTL_SEC?: string;
  ENABLE_IPAPI?: string;
  UPSTREAM_TIMEOUT_MS?: string;

  // secrets（可选数据源，缺失时对应适配器不注册）
  IPINFO_TOKEN?: string;
  ABUSEIPDB_KEY?: string;

  // 统计 / 广告（可选，公开 ID，非空时覆盖前端 site-config.js）
  SITE_GA4_ID?: string;
  SITE_BING_UET?: string;
  SITE_BAIDU_ID?: string;
  SITE_CF_ANALYTICS_TOKEN?: string;
  ADSENSE_CLIENT?: string;
  ADSENSE_SLOT_AFTER_RESULT?: string;
  ADSENSE_SLOT_BEFORE_FOOTER?: string;
}
