import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repositoryPublicDirectory = packageDirectory;
const outputDirectory = resolve(packageDirectory, "dist");
const assets = [
  { path: "index.html", maximumBytes: 1_000_000 },
  { path: "config.js", maximumBytes: 100_000 },
  { path: "frontend-new.js", maximumBytes: 2_000_000 },
  { path: "newsgo-inject.js", maximumBytes: 500_000 },
  { path: "newsgo-inject.css", maximumBytes: 100_000 },
  { path: "styles.css", maximumBytes: 1_000_000 },
  { path: "favicon.ico", maximumBytes: 1_000_000 },
];

async function exists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeOrigin(rawValue, name, required) {
  if (!rawValue?.trim()) {
    if (required) throw new Error(`${name} must be configured`);
    return undefined;
  }

  const url = new URL(rawValue.trim());
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(`${name} must be an HTTPS origin without a path, query, or credentials`);
  }
  return url.origin;
}

async function loadLocalAssets() {
  const files = await Promise.all(
    assets.map(async (asset) => {
      const source = resolve(repositoryPublicDirectory, asset.path);
      if (!(await exists(source))) return undefined;
      const body = await readFile(source);
      if (body.byteLength > asset.maximumBytes) throw new Error(`${asset.path} exceeds its build limit`);
      return [asset.path, body];
    }),
  );
  return files.every(Boolean) ? new Map(files) : undefined;
}

async function loadRemoteAssets(edgeOrigin) {
  const entries = await Promise.all(
    assets.map(async (asset) => {
      const response = await fetch(new URL(`/${asset.path}`, edgeOrigin), {
        headers: { Accept: asset.path === "index.html" ? "text/html" : "*/*" },
        redirect: "error",
      });
      if (!response.ok) throw new Error(`Unable to download ${asset.path}: HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > asset.maximumBytes) throw new Error(`${asset.path} exceeds its build limit`);
      return [asset.path, body];
    }),
  );
  return new Map(entries);
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function configureIndex(buffer, siteOrigin) {
  let html = buffer.toString("utf8");
  if (!html.includes("/frontend-new.js") || !html.includes("/styles.css") || !html.includes('id="app"')) {
    throw new Error("Downloaded index.html is not a compatible Newsgo frontend");
  }
  if (!siteOrigin) return Buffer.from(html);

  const escaped = escapeAttribute(siteOrigin);
  const siteMeta = `<meta name="newsgo-site-url" content="${escaped}">`;
  if (/<meta\b[^>]*name=["']newsgo-site-url["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta\b[^>]*name=["']newsgo-site-url["'][^>]*>/i, siteMeta);
  } else {
    html = html.replace(/<\/head>/i, `  ${siteMeta}\n  </head>`);
  }
  return Buffer.from(html);
}

const localAssets = await loadLocalAssets();
const localConfig = localAssets?.get("config.js")?.toString("utf8");
const configuredLocalOrigin = localConfig?.match(
  /apiBase\s*:\s*["']([^"']+)["']/,
)?.[1];
const apiOrigin = normalizeOrigin(
  process.env.NEWSGO_API_BASE || configuredLocalOrigin,
  "NEWSGO_API_BASE",
  !localAssets,
);
const automaticSite = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
const automaticSiteProtocol = automaticSite && /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/i.test(automaticSite)
  ? "http"
  : "https";
const rawSiteOrigin = process.env.NEWSGO_SITE_ORIGIN || (automaticSite ? `${automaticSiteProtocol}://${automaticSite}` : undefined);
const siteOrigin = normalizeOrigin(rawSiteOrigin, "NEWSGO_SITE_ORIGIN", false);
const selectedAssets = localAssets || (await loadRemoteAssets(edgeOrigin));
selectedAssets.set("index.html", configureIndex(selectedAssets.get("index.html"), siteOrigin));
selectedAssets.set(
  "config.js",
  Buffer.from(
    `globalThis.NEWSGO_CONFIG = Object.freeze(${JSON.stringify({
      apiBase: `${apiOrigin}/`,
      siteBase: `${siteOrigin || ""}/`,
    })});\n`,
  ),
);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const [path, body] of selectedAssets) {
  await writeFile(resolve(outputDirectory, path), body, { flag: "wx" });
}

console.log(`Newsgo Vercel frontend API: ${apiOrigin}`);
console.log(`Canonical browser origin: ${siteOrigin || "current deployment origin"}`);
