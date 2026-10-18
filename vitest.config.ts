import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        main: "./src/index.ts",
        isolatedStorage: false,
        wrangler: {
          configPath: "./wrangler.toml",
        },
      },
    },
  },
});
