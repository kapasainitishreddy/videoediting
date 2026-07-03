import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendor code copied in by postinstall (scripts/copy-ffmpeg-core.js) —
    // not ours to lint, and it's gitignored anyway.
    "public/ffmpeg/**",
  ]),
  {
    // Build-time Node script, run directly via `node scripts/...` outside
    // Next's ESM/TS pipeline — CommonJS require() is intentional here.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
