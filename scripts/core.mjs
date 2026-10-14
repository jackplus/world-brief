import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'node:crypto';

export const categories = ['finance', 'politics', 'ai'];
export const day = 86400000;
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const text = value => String(typeof value === 'object' ? value?.['#text'] ?? '' : value ?? '')
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,;:!?，。；：！？])/g, '$1').trim();
export function canonical(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsafe URL');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|at_)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export function parseFeed(xml, source, now) {
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE|<!ENTITY|<html[\s>]/i.test(xml)) throw new Error('Invalid feed XML');
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: true, trimValues: true }).parse(xml);
  if (!parsed.rss?.channel && !parsed.feed) throw new Error('Not RSS or Atom');
  const entries = parsed.feed ? array(parsed.feed.entry) : array(parsed.rss.channel.item);
  return entries.flatMap(entry => {
    try {
      const title = text(entry.title).slice(0, 400);
      const link = typeof entry.link === 'string' ? entry.link : array(entry.link).find(l => !l['@_rel'] || l['@_rel'] === 'alternate')?.['@_href'];
      const url = canonical(link);
      const date = text(entry.pubDate || entry.published || entry.updated || entry['dc:date']);
      const ms = Date.parse(date);
      if (!title || !Number.isFinite(ms) || ms > now || ms < now - day) return [];
      const excerpt = source.titleOnly ? '' : text(entry.description || entry.summary || entry['content:encoded']).slice(0, 180);
      return [{ id: createHash('sha256').update(url).digest('hex').slice(0, 20), title, excerpt, url,
        publishedAt: new Date(ms).toISOString(), category: source.category, sourceId: source.id, sourceName: source.name }];
    } catch { return []; }
  });
}
export function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.title.toLowerCase().replace(/[\p{P}\p{Z}]/gu, '');
    if (seen.has(item.url) || seen.has(key)) return false;
    seen.add(item.url); seen.add(key); return true;
  });
}
export function candidates(items) {
  return categories.flatMap(category => items.filter(i => i.category === category)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 32));
}
export function fallback(items) {
  const groups = categories.map(category => items.filter(i => i.category === category).slice(0, 8));
  return Array.from({ length: 8 }, (_, n) => groups.flatMap(group => group[n] ? [group[n]] : []))
    .flat().map(i => ({ id: i.id, category: i.category, title: i.title, summary: i.excerpt, publishedAt: i.publishedAt,
      mode: 'excerpt', sources: [{ name: i.sourceName, url: i.url }] }));
}
export function validateModel(value, input) {
  if (!value || !Array.isArray(value.items) || !value.items.length) throw new Error('Invalid model items');
  const byId = new Map(input.map(i => [i.id, i]));
  const used = new Set(); const counts = {};
  const result = value.items.map(item => {
    if (!categories.includes(item.category) || !Array.isArray(item.sourceIds) || !item.sourceIds.length ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > 400 ||
        typeof item.summary !== 'string' || item.summary.length > 350) throw new Error('Invalid model shape');
    if ((counts[item.category] = (counts[item.category] || 0) + 1) > 8) throw new Error('Category overflow');
    const originals = item.sourceIds.map(id => {
      const original = byId.get(id);
      if (!original || used.has(id) || original.category !== item.category) throw new Error('Unknown or duplicate source');
      used.add(id); return original;
    });
    if (originals.every(i => !i.excerpt) && item.summary.trim()) throw new Error('Title-only source must not have summary');
    return { id: originals[0].id, category: item.category, title: item.title.trim(), summary: item.summary.trim(),
      publishedAt: originals.map(i => i.publishedAt).sort().at(-1), mode: 'ai',
      sources: originals.map(i => ({ name: i.sourceName, url: i.url })) };
  });
  // Require every populated category to remain represented.
  for (const cat of categories) if (input.some(i => i.category === cat) && !counts[cat]) throw new Error('Missing category');
  return result;
}
export function validateBrief(brief) {
  if (brief.schemaVersion !== 1 || !Number.isFinite(Date.parse(brief.generatedAt)) ||
      !Array.isArray(brief.items) || !Array.isArray(brief.sourceStatus)) throw new Error('Invalid brief');
  const ids = new Set(); const counts = {};
  for (const i of brief.items) {
    if (!categories.includes(i.category) || !i.id || ids.has(i.id) || typeof i.title !== 'string' || !i.title.trim() ||
        typeof i.summary !== 'string' || !['ai', 'excerpt'].includes(i.mode) || !i.sources?.length ||
        !Number.isFinite(Date.parse(i.publishedAt)) || Date.parse(i.publishedAt) > Date.parse(brief.generatedAt) ||
        Date.parse(i.publishedAt) < Date.parse(brief.generatedAt) - day) throw new Error('Invalid news item');
    ids.add(i.id);
    if ((counts[i.category] = (counts[i.category] || 0) + 1) > 8) throw new Error('Too many items');
    i.sources.forEach(s => { canonical(s.url); if (!s.name) throw new Error('Missing attribution'); });
  }
  return brief;
}
export function chinaDate(iso) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
