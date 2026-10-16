const DEFAULT_API_ORIGIN = "https://powerhouse.my.id";
const DATABASE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const PAGE_PATTERN = /^[1-9][0-9]{0,8}$/;

class BadRequestError extends Error {}

const firstHeader = (value) => (Array.isArray(value) ? value[0] : value)
  ?.split(",", 1)[0]
  ?.trim();

const normalizeOrigin = (value, label) => {
  const url = new URL(value);
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol === "http:" && !isLoopback) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be an exact HTTPS origin (HTTP is allowed for localhost)`);
  }
  return url.origin;
};

export const getPublicOrigin = (request, environment = process.env) => {
  if (environment.VERCEL_ENV === "production" && environment.NEWSGO_SITE_ORIGIN?.trim()) {
    return normalizeOrigin(environment.NEWSGO_SITE_ORIGIN.trim(), "NEWSGO_SITE_ORIGIN");
  }

  const host = firstHeader(request.headers?.["x-forwarded-host"] || request.headers?.host);
  if (!host || /[\s/@?#]/.test(host)) {
    throw new Error("A valid request host is required to generate sitemap URLs");
  }

  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const forwardedProtocol = firstHeader(request.headers?.["x-forwarded-proto"]);
  const protocol = forwardedProtocol || (isLoopback ? "http" : "https");
  return normalizeOrigin(`${protocol}://${host}`, "Request origin");
};

const getApiOrigin = (environment) => normalizeOrigin(
  environment.NEWSGO_API_BASE?.trim() || DEFAULT_API_ORIGIN,
  "NEWSGO_API_BASE",
);

const queryValue = (value) => (Array.isArray(value) ? value[0] : value)?.toString().trim() || "";

const escapeXml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

export const rewriteSitemapXml = (xml, apiOrigin, publicOrigin, rootElement) => {
  if (!new RegExp(`<${rootElement}(?=\\s|>)`, "i").test(xml)) {
    throw new Error("The sitemap source returned an invalid XML document");
  }

  return xml.replace(/<(loc|link|guid)(\b[^>]*)>([\s\S]*?)<\/\1\s*>/gi, (element, name, attributes, rawLocation) => {
    const location = rawLocation.trim()
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    let url;
    try {
      url = new URL(location);
    } catch {
      return element;
    }
    if (url.origin !== apiOrigin) return element;

    if (["urlset", "rss"].includes(rootElement) && url.pathname === "/") {
      const database = url.searchParams.get("category");
      const slug = url.searchParams.get("slug");
      if (database && slug && DATABASE_PATTERN.test(database) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        return `<${name}${attributes}>${escapeXml(`${publicOrigin}/${encodeURIComponent(database)}/${encodeURIComponent(slug)}`)}</${name}>`;
      }
    }

    url.host = new URL(publicOrigin).host;
    url.protocol = new URL(publicOrigin).protocol;
    return `<${name}${attributes}>${escapeXml(url.href)}</${name}>`;
  });
};

const send = (response, request, status, contentType, body) => {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.end(request.method === "HEAD" ? "" : body);
};

const createXmlHandler = ({ resolveSource, rootElement, fetchImpl, environment }) => async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    send(response, request, 405, "text/plain; charset=utf-8", "Method not allowed");
    return;
  }

  try {
    const publicOrigin = getPublicOrigin(request, environment);
    const apiOrigin = getApiOrigin(environment);
    const resolvedSource = resolveSource(request);
    const sourcePath = typeof resolvedSource === "string" ? resolvedSource : resolvedSource.path;
    const expectedRoot = typeof resolvedSource === "string" ? rootElement : resolvedSource.rootElement;
    const sourceUrl = new URL(sourcePath, `${apiOrigin}/`);
    const upstream = await fetchImpl(sourceUrl, {
      headers: { Accept: "application/xml, text/xml;q=0.9" },
      signal: AbortSignal.timeout(15_000),
    });
    const upstreamBody = await upstream.text();

    if (!upstream.ok) {
      send(
        response,
        request,
        upstream.status,
        upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        upstreamBody,
      );
      return;
    }

    let xml;
    try {
      xml = rewriteSitemapXml(upstreamBody, apiOrigin, publicOrigin, expectedRoot);
    } catch {
      send(response, request, 502, "text/plain; charset=utf-8", "The sitemap source returned an invalid XML document");
      return;
    }

    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    send(response, request, 200, "application/xml; charset=utf-8", xml);
  } catch (error) {
    const status = error instanceof BadRequestError ? 400 : 502;
    const message = status === 400 ? error.message : "Sitemap generation is temporarily unavailable";
    send(response, request, status, "text/plain; charset=utf-8", message);
  }
};

export const createSitemapHandler = ({ fetchImpl = fetch, environment = process.env } = {}) => createXmlHandler({
  rootElement: "sitemapindex",
  fetchImpl,
  environment,
  resolveSource(request) {
    const database = queryValue(request.query?.database);
    const rawPage = queryValue(request.query?.page).replace(/\.xml$/i, "");
    if (!database && !rawPage) return "/sitemap_index.xml";
    if (!DATABASE_PATTERN.test(database) || !PAGE_PATTERN.test(rawPage)) {
      throw new BadRequestError("Invalid sitemap shard path");
    }
    return {
      path: `/sitemaps/${encodeURIComponent(database)}/${rawPage}.xml`,
      rootElement: "urlset",
    };
  },
});

export const createRobotsHandler = ({ environment = process.env } = {}) => (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    send(response, request, 405, "text/plain; charset=utf-8", "Method not allowed");
    return;
  }

  try {
    const origin = getPublicOrigin(request, environment);
    response.setHeader("Cache-Control", "public, max-age=3600");
    send(
      response,
      request,
      200,
      "text/plain; charset=utf-8",
      `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap_index.xml\n`,
    );
  } catch {
    send(response, request, 400, "text/plain; charset=utf-8", "Invalid site origin");
  }
};

export const createRssHandler = ({ fetchImpl = fetch, environment = process.env } = {}) => createXmlHandler({
  rootElement: "rss",
  fetchImpl,
  environment,
  resolveSource: () => "/rss.xml",
});