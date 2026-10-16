import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const config = JSON.parse(await readFile(resolve(packageDirectory, "vercel.json"), "utf8"));
const packageJson = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));

assert.equal(config.outputDirectory, "dist");
const rewriteSources = new Set(config.rewrites.map((route) => route.source));
for (const source of [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemaps/:database/:page.xml",
  "/robots.txt",
  "/rss.xml",
  "/:database/:slug",
]) {
  assert.ok(rewriteSources.has(source), `Missing Vercel rewrite: ${source}`);
}
assert.ok(config.headers.some((route) => route.source === "/(.*)"));
assert.equal(packageJson.scripts.dev, undefined, "The dev script must not recursively call Vercel CLI");
assert.ok((await readFile(resolve(packageDirectory, "index.html"), "utf8")).includes("/config.js"));
assert.ok((await readFile(resolve(packageDirectory, "index.html"), "utf8")).includes("/sitemap_index.xml"));
assert.ok(await readFile(resolve(packageDirectory, "api/sitemap.js"), "utf8"));


const publicFiles = ["vercel.json", "package.json", ".env.example"];
for (const path of publicFiles) {
  const source = await readFile(resolve(packageDirectory, path), "utf8");
  assert.doesNotMatch(source, /ORIGIN_API_KEY\s*=/);
}

const repositoryFrontend = resolve(packageDirectory, "..", "csr", "newsgo-public", "frontend-new.js");
const frontendSource = await readFile(repositoryFrontend, "utf8");
assert.ok(frontendSource.includes('const base = `v1/databases/${encodeURIComponent(database)}/articles`;'));
assert.ok(frontendSource.includes('apiGet(`${base}/random?limit=${ARTICLE_LIMIT}`, signal, { fresh: true })'));
assert.match(frontendSource, /return `\/\$\{encodeURIComponent\(database\)\}\/\$\{encodeURIComponent\(slug\)\}`/);
assert.ok((await readFile(resolve(packageDirectory, "frontend-new.js"), "utf8")).includes("window.NEWSGO_CONFIG?.apiBase"));
for (const asset of ["styles.css", "newsgo-inject.css", "newsgo-inject.js"]) {
  const source = resolve(packageDirectory, "..", "csr", "newsgo-public", asset);
  const target = resolve(packageDirectory, asset);
  assert.deepEqual(await readFile(target), await readFile(source), `${asset} should match CSR`);
}

console.log("Vercel package checks passed");
