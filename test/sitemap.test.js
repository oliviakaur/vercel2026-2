import assert from "node:assert/strict";
import test from "node:test";
import { createRobotsHandler, createRssHandler, createSitemapHandler } from "../lib/sitemap.js";

const captureResponse = () => ({
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  },
  end(body) {
    this.body = body;
  },
});

test("serves an XML sitemap index with the Vercel request origin", async () => {
  const requests = [];
  const handler = createSitemapHandler({
    environment: {},
    async fetchImpl(url) {
      requests.push(url.href);
      return new Response(
        '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://powerhouse.my.id/sitemaps/automotive/1.xml</loc></sitemap></sitemapindex>',
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    },
  });
  const response = captureResponse();

  await handler({ method: "GET", headers: { host: "news.vercel.app", "x-forwarded-proto": "https" }, query: {} }, response);

  assert.deepEqual(requests, ["https://powerhouse.my.id/sitemap_index.xml"]);
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Content-Type"], /application\/xml/);
  assert.match(response.body, /https:\/\/news\.vercel\.app\/sitemaps\/automotive\/1\.xml/);
});

test("serves article sitemap shards as XML and rewrites their article URLs", async () => {
  const requests = [];
  const handler = createSitemapHandler({
    environment: {},
    async fetchImpl(url) {
      requests.push(url.href);
      return new Response(
        '<?xml version="1.0"?><urlset><url><loc>https://powerhouse.my.id/?category=automotive&amp;slug=example-article</loc></url></urlset>',
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    },
  });
  const response = captureResponse();

  await handler({
    method: "GET",
    headers: { host: "localhost:3000" },
    query: { database: "automotive", page: "1.xml" },
  }, response);

  assert.deepEqual(requests, ["https://powerhouse.my.id/sitemaps/automotive/1.xml"]);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /http:\/\/localhost:3000\/automotive\/example-article/);
});

test("rejects invalid sitemap shard parameters without calling the backend", async () => {
  let requested = false;
  const handler = createSitemapHandler({
    environment: {},
    async fetchImpl() {
      requested = true;
      return new Response("<urlset />");
    },
  });
  const response = captureResponse();

  await handler({
    method: "GET",
    headers: { host: "localhost:3000" },
    query: { database: "../private", page: "0.xml" },
  }, response);

  assert.equal(requested, false);
  assert.equal(response.statusCode, 400);
});

test("publishes robots.txt with the Vercel sitemap URL", () => {
  const handler = createRobotsHandler({ environment: {} });
  const response = captureResponse();

  handler({ method: "GET", headers: { host: "news.vercel.app", "x-forwarded-proto": "https" } }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Sitemap: https:\/\/news\.vercel\.app\/sitemap_index\.xml/);
});

test("serves RSS XML with Vercel article paths", async () => {
  const handler = createRssHandler({
    environment: {},
    async fetchImpl() {
      return new Response(
        '<?xml version="1.0"?><rss version="2.0"><channel><link>https://powerhouse.my.id</link><item><link>https://powerhouse.my.id/?category=automotive&amp;slug=example-article</link><guid isPermaLink="true">https://powerhouse.my.id/?category=automotive&amp;slug=example-article</guid></item></channel></rss>',
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    },
  });
  const response = captureResponse();

  await handler({ method: "GET", headers: { host: "news.vercel.app", "x-forwarded-proto": "https" } }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /<link>https:\/\/news\.vercel\.app\/automotive\/example-article<\/link>/);
  assert.match(response.body, /<guid isPermaLink="true">https:\/\/news\.vercel\.app\/automotive\/example-article<\/guid>/);
});