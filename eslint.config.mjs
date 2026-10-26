// ESLint for the app's front end: `npm run -s lint` (which runs tsc too), or the VSCode extension, which finds this
// file at the repo root.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    {ignores: ["**/node_modules/", ".venv/", "dist/", "ignored/", "src/dji_thermal_ui/static/vendor/",
              "src/dji_thermal_ui/static/dist/"]},
    {
        // The pages and their tests, in TypeScript
        files: ["frontend/**/*.{ts,tsx}", "vite.config.ts"],
        ...js.configs.recommended,
    },
    ...tseslint.configs.recommended.map((c) => ({...c, files: ["frontend/**/*.{ts,tsx}", "vite.config.ts"]})),
    {
        files: ["frontend/**/*.{ts,tsx}", "vite.config.ts"],
        languageOptions: {globals: {...globals.browser, ...globals.node}},
        rules: {"@typescript-eslint/no-unused-vars": ["error", {argsIgnorePattern: "^_", caughtErrors: "none"}]},
    },
    {
        // The old pages' scripts, until they are replaced: plain ES5, loaded by <script> tags and by Jest (UMD)
        files: ["src/dji_thermal_ui/static/*.js"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 5,
            sourceType: "script",
            // ES5 syntax, but the ES2015 Promise the browsers have; module and require are the UMD wrapper's
            globals: {...globals.browser, Promise: "readonly", module: "readonly", require: "readonly", L: "readonly"},
        },
        // ES5 has no catch without a binding, so one left unused is no mistake
        rules: {...js.configs.recommended.rules, "no-unused-vars": ["error", {caughtErrors: "none"}]},
    },
    {
        files: ["src/dji_thermal_ui/static/__tests__/**/*.js"],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "commonjs",
            globals: {...globals.browser, ...globals.node, ...globals.jest},
        },
    },
];
