import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './tools.js';
import { INGREDIENTS } from './lib.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

/**
 * Measured 2026-11-14 on the estate's hosted endpoint: a major MCP client sends tool calls with
 * mcp-protocol-version 2026-07-28, newer than this SDK knows, and the SDK answers 400.
 * A well-formed date newer than the SDK's latest is served as the latest; malformed or
 * older values are left for the SDK to reject.
 */
export function normalizeProtocolVersion(request: Request): Request {
  const v = request.headers.get('mcp-protocol-version')?.trim();
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v <= LATEST_PROTOCOL_VERSION) return request;
  const headers = new Headers(request.headers);
  headers.set('mcp-protocol-version', LATEST_PROTOCOL_VERSION);
  return new Request(request, { headers });
}

// No edge cache is needed here: every tool is pure arithmetic over the bundled density table and the Worker makes
// no upstream fetch, so there is no upstream error that could be cached (test/no-upstream.test.mjs checks this).

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
};

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOOLS: [string, string][] = [
  ['convert_ingredient', 'Cups, tbsp, tsp, ml, fl oz, grams and ounces for 30+ ingredients using a real density table'],
  ['list_ingredients', 'The full density table (grams per US cup) with sources and aliases'],
  ['scale_recipe', 'Scale recipe lines by a factor, output in friendly fractions'],
  ['convert_bulk', 'Convert up to 100 ingredient amounts in one call'],
  ['decimal_to_fraction', '0.5 -> 1/2, 1.75 -> 1 3/4, with a denominator cap'],
  ['fraction_to_decimal', "'1 1/2' -> 1.5"],
  ['common_conversions', 'The most-googled cooking conversions'],
];

function page(origin: string): string {
  const url = `${origin}/mcp`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ingredient Unit Converter MCP</title>
<meta name="description" content="Free remote MCP server: convert cooking ingredients between cups, tablespoons, teaspoons, millilitres, fluid ounces, grams and ounces with a real density table, plus recipe scaling and bulk conversion.">
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;color:#1a1a1a;background:#fff}code,pre{background:#f3f3f3;border-radius:4px;padding:2px 5px;font-size:14px}pre{padding:12px;overflow-x:auto}td{padding:4px 8px;vertical-align:top;border-bottom:1px solid #eee}a{color:#0b57d0}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}code,pre{background:#222}td{border-color:#333}a{color:#8ab4f8}}</style></head><body>
<h1>Ingredient Unit Converter MCP</h1>
<p>Cooking conversions for AI assistants. Cups, tablespoons, teaspoons, millilitres, fluid ounces, grams and ounces across ${INGREDIENTS.length} ingredients, using a per-ingredient density table instead of a single generic "1 cup = 240 ml". No sign-in, no token.</p>
<p>MCP endpoint (Streamable HTTP): <code>${esc(url)}</code></p>
<h2>Tools</h2><table>${TOOLS.map(([n, d]) => `<tr><td><code>${n}</code></td><td>${d}</td></tr>`).join('')}</table>
<h2>Install</h2>
<p>Claude.ai custom connector or ChatGPT developer mode: paste <code>${esc(url)}</code>.</p>
<pre>claude mcp add --transport http ingredient-convert ${esc(url)}</pre>
<p>Source: <a href="https://github.com/theluckystrike/${SERVER_NAME}">github.com/theluckystrike/${SERVER_NAME}</a>. Conversions and calculators: <a href="https://ingredientcalculator.com">ingredientcalculator.com</a>.</p>
<p>Densities are US customary reference values (King Arthur flour chart, USDA where available). Volume measures assume level, unpacked cups.</p>
<p>Part of the Zovo MCP collection: <a href="https://mcp.zovo.one">https://mcp.zovo.one</a></p>
</body></html>`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(page(url.origin), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/health') return Response.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION });
    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      if (request.method === 'GET' || request.method === 'DELETE') {
        return withCors(new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This server is stateless; use POST.' }, id: null }), { status: 405, headers: { 'content-type': 'application/json', Allow: 'POST' } }));
      }
      const server = createServer();
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      const res = await transport.handleRequest(normalizeProtocolVersion(request));
      return withCors(res);
    }
    return new Response('Not found. The MCP endpoint is /mcp.', { status: 404 });
  },
};
