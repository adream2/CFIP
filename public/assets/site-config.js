/**
 * CFIP 站点配置 —— 统计与广告接入口
 *
 * 用法：改这里 → push → Actions 自动部署生效。留空字符串 = 关闭（默认全关，
 * 保持「零外部请求」）。也可以不改代码，改用 wrangler.toml [vars] 或
 * Cloudflare Dashboard 环境变量（同名变量非空时覆盖本文件，见 README）。
 *
 * 注意：本项目无 Cookie 同意弹窗。若面向欧盟用户投放 AdSense，
 * 需自行接入 Google 认证的 CMP（同意管理平台），否则可能违反 AdSense 政策。
 */

export const siteConfig = {
  analytics: {
    // Google Analytics 4：测量 ID，形如 G-XXXXXXXXXX
    ga4: '',
    // Bing UET：标签 ID（纯数字）
    bing: '',
    // 百度统计：hm.js 的 id（32 位十六进制）
    baidu: '',
    // Cloudflare Web Analytics：站点 token（部署在 CF 上，免费且无 Cookie）
    cloudflare: '',
  },

  adsense: {
    // Google AdSense 发布商 ID，形如 ca-pub-XXXXXXXXXXXXXXXX
    client: '',
    // 广告单元 slot ID（纯数字，后台创建广告单元后获得）
    slots: {
      // 查询结果区下方
      afterResult: '',
      // 页脚推广卡上方
      beforeFooter: '',
    },
  },
};

// 方便在控制台调试：window.CFIP_SITE
if (typeof window !== 'undefined') window.CFIP_SITE = siteConfig;
