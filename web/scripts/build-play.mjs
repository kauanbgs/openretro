// Puts the app's web build (docs/PLAY_WEB.md) at /play/ of the website, so
// every host that builds the site (Vercel for openretro.com.br, GitHub Pages)
// serves the demo the "Try the demo" button opens.
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const site = fileURLToPath(new URL("../dist/", import.meta.url));
const run = (command) => execSync(command, { cwd: root, stdio: "inherit" });

// A host that only installed the site's packages installs the app's too.
if (!existsSync(`${root}node_modules/vite`)) run("npm ci");
run("npx vite build --mode play");
rmSync(`${site}play`, { recursive: true, force: true });
cpSync(`${root}dist-play`, `${site}play`, { recursive: true });
console.log("Web build copied to dist/play/");
