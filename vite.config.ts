// The pages' front end: one entry per page in frontend/src/pages, built into the package's static/dist with a
// manifest the templates read (templatetags/vite.py). `npm run build` (`-- --watch` while working on it).
// The tests are Vitest's, in frontend/tests.
import fs from "node:fs";
import path from "node:path";
import preact from "@preact/preset-vite";
import {defineConfig, type Plugin} from "vitest/config";

const FRONTEND = path.resolve(__dirname, "frontend");
const PAGES = path.join(FRONTEND, "src/pages");

// Each page's entry: frontend/src/pages/<name>.tsx
function entries(): Record<string, string> {
    return Object.fromEntries(fs.readdirSync(PAGES)
        .filter((f) => /^[a-z_]+\.tsx$/.test(f))
        .map((f) => [f.replace(/\.tsx$/, ""), path.join(PAGES, f)]));
}

// The licences of the packages bundled into the pages, in THIRD-PARTY-LICENSES.txt beside them
function licences(): Plugin {
    return {
        name: "third-party-licenses",
        apply: "build",
        generateBundle(_options, bundle) {
            const dirs = new Set<string>();
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== "chunk") continue;
                for (const id of chunk.moduleIds) {
                    const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id);
                    if (m) dirs.add(m[1]);
                }
            }
            const parts = [...dirs].sort().map((dir) => {
                const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
                const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
                if (!file) throw new Error(`${pkg.name} has no licence file`);
                const text = fs.readFileSync(path.join(dir, file), "utf8").trim();
                return `${pkg.name} ${pkg.version} (${pkg.license})\n\n${text}\n`;
            });
            this.emitFile({type: "asset", fileName: "THIRD-PARTY-LICENSES.txt",
                           source: "The packages bundled into these files, and their licences.\n\n" +
                               parts.join("\n" + "-".repeat(78) + "\n\n")});
        },
    };
}

export default defineConfig({
    root: FRONTEND,
    base: "/static/dist/",
    plugins: [preact(), licences()],
    build: {
        outDir: path.resolve(__dirname, "src/dji_thermal_ui/static/dist"),
        emptyOutDir: true,
        manifest: true,
        rollupOptions: {input: entries()},
    },
    test: {
        root: FRONTEND,
        environment: "jsdom",
        include: ["tests/**/*.test.{ts,tsx}"],
    },
});
