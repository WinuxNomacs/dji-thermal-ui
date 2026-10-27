// ESLint for the app's front end: `npm run -s lint` (which runs tsc too), or the VSCode extension, which finds this
// file at the repo root.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    {ignores: ["**/node_modules/", ".venv/", "dist/", "ignored/", "src/dji_thermal_ui/static/dist/"]},
    {
        // The pages and their tests, in TypeScript
        files: ["frontend/**/*.{ts,tsx}", "vite.config.mts"],
        ...js.configs.recommended,
    },
    ...tseslint.configs.recommended.map((c) => ({...c, files: ["frontend/**/*.{ts,tsx}", "vite.config.mts"]})),
    {
        files: ["frontend/**/*.{ts,tsx}", "vite.config.mts"],
        languageOptions: {globals: {...globals.browser, ...globals.node}},
        rules: {"@typescript-eslint/no-unused-vars": ["error", {argsIgnorePattern: "^_", caughtErrors: "none"}]},
    },
];
