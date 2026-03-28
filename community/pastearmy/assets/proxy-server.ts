/**
 * paste.trade Local Proxy Server
 *
 * Proxies API requests to paste.trade (bypassing CORS) and serves static HTML pages.
 *
 * Setup:
 *   1. Set PASTE_TRADE_KEY env var with your API key
 *   2. Run: bun run server.ts
 *   3. Open: http://localhost:3456
 *
 * Add new pages:
 *   1. Create a .html file in this directory
 *   2. Add a route in the routing section below
 */

const API_KEY = process.env.PASTE_TRADE_KEY || "";
const API_BASE = "https://paste.trade";
const PORT = 3456;

if (!API_KEY) {
  console.warn("WARNING: PASTE_TRADE_KEY not set. API requests will fail.");
  console.warn("Set it with: export PASTE_TRADE_KEY=your_key_here");
}

// Route map: URL path → HTML file
const routes: Record<string, string> = {
  "/": "index.html",
  // Add your pages here:
  // "/authors": "author-list.html",
  // "/author": "author-profile.html",
  // "/clusters": "cluster-map.html",
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // --- API Proxy ---
    if (url.pathname.startsWith("/api/")) {
      const apiUrl = `${API_BASE}${url.pathname}${url.search}`;
      try {
        const resp = await fetch(apiUrl, {
          headers: {
            "x-api-key": API_KEY,
            "Authorization": `Bearer ${API_KEY}`,
          },
        });
        return new Response(resp.body, {
          status: resp.status,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: "API request failed" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // --- Static Pages ---
    // Check exact route match
    const routeFile = routes[url.pathname];
    if (routeFile) {
      try {
        const file = Bun.file(routeFile);
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html" },
          });
        }
      } catch {}
    }

    // Try direct file match (e.g., /my-page → my-page.html)
    if (!url.pathname.includes(".")) {
      const fileName = url.pathname.slice(1) + ".html";
      try {
        const file = Bun.file(fileName);
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html" },
          });
        }
      } catch {}
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`paste.trade proxy server running at http://localhost:${PORT}`);
console.log(`API key: ${API_KEY ? "set" : "NOT SET"}`);
