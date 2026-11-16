import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "build.mjs", "schema.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "no-warning-comments": "error",
      "no-inline-comments": "error",
      "line-comment-position": "error",
      "@typescript-eslint/no-shadow": "error",
    },
  },
  {
    files: ["src/marks/**/*.ts"],
    ignores: ["src/marks/diagram.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [{ group: ["../grammar/*"], allowTypeImports: true, message: "A view reads the tables in data/tables; only diagram reads the grammar." }] },
      ],
    },
  },
);
