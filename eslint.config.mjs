import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const TESTS = "**/*.test.{ts,tsx}";

const ROLES = [
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
];

const SCREEN = {
  selector: "JSXAttribute[name.name='data-export']",
  message: "data-export has had no consumer since 239aca5; wrap screen-only UI in <ScreenOnly> so print hides it too",
};

const FIELD_FILES = ["lib/play/**/*.{ts,tsx}", "lib/render/**/*.{ts,tsx}"];
/** A retyped field bound: a sideline, the backfield, the deepest spot, the line-of-scrimmage gap, or the old -36 deep bound. */
const BOUNDS = {
  selector: "Literal[raw=/^(1\\.2|28\\.8|7\\.4|48\\.8|0\\.9)$/], UnaryExpression[operator='-'] > Literal[raw='36']",
  message: "Field bounds live in lib/play/bounds.ts (6a94d46 missed a -36 literal)",
};

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
    ignores: ["lib/play/roles.ts", TESTS],
    rules: { "no-restricted-syntax": ["error", ...ROLES, SCREEN] },
  },
  // a later block's options replace an earlier one's, so this one repeats ROLES and SCREEN for its files
  {
    files: FIELD_FILES,
    ignores: ["lib/play/bounds.ts", "lib/play/roles.ts", TESTS],
    rules: { "no-restricted-syntax": ["error", ...ROLES, SCREEN, BOUNDS] },
  },
  { files: ["lib/play/roles.ts"], rules: { "no-restricted-syntax": ["error", BOUNDS] } },
  { files: ["**/*.mjs", "**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
  globalIgnores(["playwright-report/**", "test-results/**", "blob-report/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "design/**", "node_modules/**"]),
]);

export default eslintConfig;
