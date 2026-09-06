import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": true }],
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  { files: ["**/*.mjs", "**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "design/**", "node_modules/**"]),
]);

export default eslintConfig;
