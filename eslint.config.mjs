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
  {
    files: ["lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["lib/play/roles.ts", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...[
          "BinaryExpression[operator=/^[!=]==?$/]:matches([left.property.name='label'], [left.name='label'])[right.value=/^(QB|C)$/]",
          "BinaryExpression[operator=/^[!=]==?$/]:matches([right.property.name='label'], [right.name='label'])[left.value=/^(QB|C)$/]",
          "SwitchStatement:matches([discriminant.property.name='label'], [discriminant.name='label']) > SwitchCase[test.value=/^(QB|C)$/]",
        ].map((selector) => ({
          selector,
          message: "Tags are editable, so two players can be tagged QB, or none. Find the quarterback or centre with quarterback() or centre() from lib/play/roles.ts and compare ids, as playback does (f3e82a8).",
        })),
        {
          selector: "BinaryExpression[operator=/^[!=]==?$/]:matches([left.property.name='id'], [left.name='id'])[right.value=/^o[12]$/]",
          message: "o1 and o2 are only the default centre and quarterback slots. Call centre() or quarterback() from lib/play/roles.ts, which owns that fallback.",
        },
        {
          selector: "JSXAttribute[name.name='data-export']",
          message: "data-export has had no consumer since 239aca5; wrap screen-only UI in <ScreenOnly> so print hides it too",
        },
      ],
    },
  },
  { files: ["**/*.mjs", "**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
  globalIgnores(["playwright-report/**", "test-results/**", "blob-report/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "design/**", "node_modules/**"]),
]);

export default eslintConfig;
