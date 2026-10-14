import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFeed, canonical, dedupe, candidates, fallback, validateModel, validateBrief, chinaDate, day } from '../scripts/core.mjs';
import { collect, summarize, publish } from '../scripts/update.mjs';

const now = Date.parse('2026-10-14T12:00:00Z');
const source = { id: 'test', name: 'Test News', category: 'finance', enabled: true, url: 'https://example.org/rss' };
const xml = (date, extra = '') => `<rss version="2.0"><channel><title>Test</title><item><title><![CDATA[Market &amp; policy]]></title><link>https://example.org/a?utm_source=rss</link><pubDate>${date}</pubDate><description><![CDATA[<p>Reported <b>fact</b>.</p>]]></description></item>${extra}</channel></rss>`;
const item = (id = 'a', category = 'finance') => ({ id, category, title: `News ${id}`, excerpt: 'A reported fact.', url: `https://example.org/${id}`, sourceName: 'Test News', sourceId: 'test', publishedAt: new Date(now - 1000).toISOString() });
const brief = (date = now) => ({ schemaVersion: 1, generatedAt: new Date(date).toISOString(), coverageStart: new Date(date - day).toISOString(), coverageEnd: new Date(date).toISOString(), mode: 'excerpt', sourceStatus: [], items: fallback([{ ...item(), publishedAt: new Date(date - 1000).toISOString() }]) });

test('RSS preserves source date, strips markup and removes tracking', () => {
  const [entry] = parseFeed(xml('Wed, 14 Oct 2026 19:00:00 +0800'), source, now);
  assert.equal(entry.publishedAt, '2026-10-14T11:00:00.000Z');
  assert.equal(entry.excerpt, 'Reported fact.');
  assert.equal(entry.url, 'https://example.org/a');
});
test('24h boundary inclusive; future, missing and expired dates excluded', () => {
  assert.equal(parseFeed(xml(new Date(now - day).toUTCString()), source, now).length, 1);
  for (const date of ['', 'invalid', new Date(now + 1000).toUTCString(), new Date(now - day - 1000).toUTCString()])
    assert.equal(parseFeed(xml(date), source, now).length, 0);
});
test('rejects HTML, malformed XML and entity declarations', () => {
  for (const body of ['<html></html>', '<rss>', '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'])
    assert.throws(() => parseFeed(body, source, now));
});
test('Atom alternate links and title-only sources supported', () => {
  const body = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Model</title><link rel="self" href="https://example.org/api"/><link rel="alternate" href="https://example.org/blog"/><published>2026-10-14T11:00:00Z</published><summary>Long text</summary></entry></feed>`;
  const [entry] = parseFeed(body, { ...source, titleOnly: true }, now);
  assert.equal(entry.url, 'https://example.org/blog'); assert.equal(entry.excerpt, '');
});
test('URL handling rejects executable and credential URLs; keeps meaningful query', () => {
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.org/']) assert.throws(() => canonical(url));
  assert.equal(canonical('https://example.org/a?b=2&utm_medium=rss&a=1#top'), 'https://example.org/a?a=1&b=2');
});
test('deduplication handles identical headlines and links', () => {
  assert.equal(dedupe([item(), { ...item('b'), title: 'NEWS a!' }, { ...item('c'), url: item().url }]).length, 1);
});
test('selection caps each category and fallback balances lead stories', () => {
  const entries = Array.from({ length: 40 }, (_, n) => item(String(n)));
  assert.equal(candidates(entries).length, 32);
  const selected = fallback([...entries, item('p', 'politics'), item('i', 'ai')]);
  assert.equal(selected.length, 10);
  assert.deepEqual(selected.slice(0, 3).map(i => i.category), ['finance', 'politics', 'ai']);
});
test('valid model merges supplied sources without accepting generated links', () => {
  const input = [item(), item('b')];
  const [result] = validateModel({ items: [{ category: 'finance', title: '中文标题', summary: '事实摘要', sourceIds: ['a', 'b'], url: 'https://evil.example/' }] }, input);
  assert.deepEqual(result.sources.map(s => s.url), input.map(i => i.url));
});
test('invalid model sources, categories, duplicate ids and title-only elaboration rejected', () => {
  const valid = { category: 'finance', title: '标题', summary: '摘要', sourceIds: ['a'] };
  for (const bad of [{ ...valid, sourceIds: ['missing'] }, { ...valid, category: 'ai' }, { ...valid, title: '' }, { ...valid, sourceIds: ['a', 'a'] }])
    assert.throws(() => validateModel({ items: [bad] }, [item()]));
  assert.throws(() => validateModel({ items: [valid] }, [{ ...item(), excerpt: '' }]));
  assert.throws(() => validateModel({ items: [valid] }, [item(), item('p', 'politics')]));
});
test('rate limits, malformed model response and missing key degrade gracefully', async () => {
  for (const mock of [async () => ({ ok: false, status: 429 }), async () => ({ ok: true, json: async () => ({ candidates: [] }) })]) {
    const output = await summarize([item()], 'test-secret', mock);
    assert.equal(output.mode, 'excerpt'); assert.equal(output.items[0].title, 'News a');
    assert.ok(!JSON.stringify(output).includes('test-secret'));
  }
  assert.equal((await summarize([item()], '')).mode, 'excerpt');
});
test('collector tolerates partial failure and reports disabled feeds', async () => {
  const sources = [source, { ...source, id: 'broken' }, { ...source, id: 'off', enabled: false }];
  let requests = 0;
  const output = await collect(sources, now, async () => ++requests === 1 ? { ok: true, text: async () => xml('Wed, 14 Oct 2026 11:00:00 GMT') } : { ok: false, status: 403 });
  assert.equal(output.items.length, 1);
  assert.deepEqual(output.status.map(s => s.state), ['ok', 'error', 'disabled']);
  assert.equal(requests, 2);
});
test('all failed feeds throw before publication', async () => {
  await assert.rejects(collect([source], now, async () => ({ ok: false, status: 503 })), /All enabled sources failed/);
});
test('Beijing day boundary is independent of host timezone', () => {
  assert.equal(chinaDate('2026-10-14T15:59:59Z'), '2026-10-14');
  assert.equal(chinaDate('2026-10-14T16:00:00Z'), '2026-10-15');
});
test('invalid news date or unsafe link fails final validation', () => {
  const bad = brief(); bad.items[0].publishedAt = 'invalid'; assert.throws(() => validateBrief(bad));
  const unsafe = brief(); unsafe.items[0].sources[0].url = 'javascript:alert(1)'; assert.throws(() => validateBrief(unsafe));
});
test('publication keeps seven calendar days, replaces same-day edition, preserves old index on validation failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'world-brief-'));
  try {
    for (let n = 9; n >= 0; n--) await publish(brief(now - n * day), dir);
    await publish(brief(now + 1000), dir);
    const before = await readFile(join(dir, 'index.json'), 'utf8');
    const index = JSON.parse(before);
    assert.equal(index.editions.length, 7);
    assert.equal(index.editions[0].date, '2026-10-14');
    assert.equal(index.editions.at(-1).date, '2026-10-08');
    const saved = JSON.parse(await readFile(join(dir, index.editions[0].file), 'utf8'));
    assert.equal(saved.generatedAt, new Date(now + 1000).toISOString());
    await assert.rejects(publish({ ...brief(), items: [{ id: 'invalid' }] }, dir));
    assert.equal(await readFile(join(dir, 'index.json'), 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
