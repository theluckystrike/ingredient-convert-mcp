// The satellite template caches upstream answers at the edge, and its fix (2026-11-17) caches only 2xx answers so one
// upstream 403 or 5xx is not served to every caller. This Worker has no upstream: every tool is arithmetic over the
// bundled density table. These tests pin that down, so there is no upstream error that the edge could cache.
// They load the wrangler bundle (out/worker.js), the exact file that is deployed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../out/worker.js';

async function call(body, version) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (version) headers['mcp-protocol-version'] = version;
  const res = await worker.fetch(new Request('https://worker.test/mcp', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, json: JSON.parse(await res.text()) };
}

test('every tool answers with no outbound fetch (no upstream, nothing to cache)', async () => {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); throw new Error('no network in this test'); };
  try {
    const calls = [
      ['convert_ingredient', { ingredient: 'all-purpose flour', amount: 1, unit: 'cups' }],
      ['list_ingredients', {}],
      ['scale_recipe', { items: [{ ingredient: 'sugar', amount: '1 1/2', unit: 'cups' }], factor: 2 }],
      ['convert_bulk', { items: [{ ingredient: 'butter', amount: 1, unit: 'tbsp' }, { ingredient: 'nope', amount: 1, unit: 'cups' }] }],
      ['decimal_to_fraction', { value: 1.75 }],
      ['fraction_to_decimal', { value: '1 1/2' }],
      ['common_conversions', {}],
    ];
    let id = 1;
    for (const [name, args] of calls) {
      const r = await call({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }, '2026-07-28');
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.result.isError, undefined, `${name}: ${JSON.stringify(r.json)}`);
      assert.ok(r.json.result.structuredContent.summary, name);
    }
    const flour = await call({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'convert_ingredient', arguments: { ingredient: 'all-purpose flour', amount: 1, unit: 'cups' } } });
    const grams = flour.json.result.structuredContent.results.find((x) => x.unit === 'grams').amount;
    assert.equal(grams, 125);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(seen, [], 'the Worker made an outbound fetch');
});

test('health and home page are served without a fetch', async () => {
  const h = await worker.fetch(new Request('https://worker.test/health'));
  assert.equal(h.status, 200);
  assert.deepEqual(await h.json(), { ok: true, name: 'ingredient-convert-mcp', version: '1.0.1' });
  const home = await worker.fetch(new Request('https://worker.test/'));
  assert.equal(home.status, 200);
  assert.match(await home.text(), /ingredient-convert-mcp\.lipmichal|\/mcp/);
});
