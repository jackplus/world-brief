const labels = { finance: '环球财经', politics: '时事政治', ai: 'AI 前沿' };
const $ = id => document.getElementById(id);
const fmt = (date, options) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...options }).format(new Date(date));
const stamp = date => fmt(date, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
let manifest, current, selected = 'latest', category = 'all', requestId = 0, checking = false;
let displayedVersion;
function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = content;
  return element;
}
function link(source, title = source.name) {
  const a = node('a', '', title);
  const url = new URL(source.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid source URL');
  a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
function card(item, lead, index) {
  const article = node('article', lead ? 'lead' : 'story');
  article.id = `${lead ? 'lead' : 'story'}-${item.id}`;
  const heading = node('div', 'story-heading');
  heading.append(node('span', `tag ${item.category}`, labels[item.category]));
  const time = node('time', '', stamp(item.publishedAt)); time.dateTime = item.publishedAt;
  if (lead) article.append(node('span', 'number', `0${index + 1}`));
  else heading.append(time);
  article.append(heading);
  const h3 = node('h3'); h3.append(link(item.sources[0], item.title)); article.append(h3);
  if (item.summary) article.append(node('p', '', item.summary));
  const byline = node('div', 'attribution');
  item.sources.forEach(s => byline.append(link(s, `${s.name} ↗`)));
  byline.append(node('span', 'mode', item.mode === 'ai' ? 'AI 摘要' : '原文摘录'));
  if (lead) byline.append(time);
  article.append(byline); return article;
}
function renderNews() {
  const items = current.items.filter(i => category === 'all' || i.category === category);
  $('count').textContent = `${items.length} 则`;
  $('news-grid').replaceChildren(...items.map((i, n) => card(i, false, n)));
  $('empty').hidden = items.length > 0;
  $('highlights').hidden = current.items.length === 0 || category !== 'all';
  $('lead-grid').replaceChildren(...current.items.slice(0, 3).map((i, n) => card(i, true, n)));
}
function render() {
  $('edition-date').textContent = fmt(current.generatedAt, { month: 'long', day: 'numeric', weekday: 'long' });
  $('updated').textContent = `更新于 ${stamp(current.generatedAt)}`;
  $('coverage').textContent = `覆盖 ${stamp(current.coverageStart)} — ${stamp(current.coverageEnd)}`;
  const errors = current.sourceStatus.filter(s => s.state === 'error');
  const stale = Date.now() - Date.parse(current.generatedAt) > 86400000;
  const notices = [selected !== 'latest' ? '正在查看历史简报。' : '', stale ? '本期已超过24小时，内容可能过期。' : '', current.notice || '', errors.length ? `${errors.length} 个来源暂不可用，详见采集状态。` : ''].filter(Boolean);
  $('status').textContent = notices.join(' ') || '本期精选已更新。每条资讯均附原始来源，可点击核对。';
  $('status').classList.toggle('warning', stale || errors.length > 0 || current.mode === 'excerpt');
  $('source-status').replaceChildren(...current.sourceStatus.map(s => node('li', '', `${s.name} · ${s.state === 'ok' ? `已读取，近24小时 ${s.count} 条` : s.state === 'disabled' ? '未启用，待确认可用性与展示授权' : `暂不可用（${s.note}）`}`)));
  renderNews();
}
async function json(path) {
  const response = await fetch(new URL(path, document.baseURI), { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load data');
  return response.json();
}
function safeFile(file) {
  if (!/^editions\/[\d-]+\.json$/.test(file)) throw new Error('Invalid edition path');
  return `./data/${file}`;
}
function options() {
  const control = $('edition');
  const latest = node('option', '', '最新一期'); latest.value = 'latest';
  control.replaceChildren(latest, ...manifest.editions.map(e => {
    const option = node('option', '', e.date); option.value = e.date; return option;
  }));
  control.disabled = false; control.value = selected;
}
async function loadEdition() {
  const ticket = ++requestId;
  const edition = selected === 'latest' ? manifest.editions[0] : manifest.editions.find(e => e.date === selected);
  if (!edition) throw new Error('Edition unavailable');
  const data = await json(safeFile(edition.file));
  if (!Array.isArray(data.items) || !data.generatedAt) throw new Error('Invalid brief');
  if (ticket !== requestId) return;
  current = data;
  if (selected === 'latest') displayedVersion = edition.file;
  render();
  $('apply-update').hidden = selected !== 'latest' || displayedVersion === manifest.editions[0]?.file;
}
function errorStatus(message) { $('status').textContent = message; $('status').classList.add('warning'); }
async function check() {
  if (checking) return;
  checking = true;
  try {
    const next = await json('./data/index.json');
    if (!next.editions?.length) throw new Error('No published editions');
    manifest = next; options();
    if (!current) await loadEdition();
    else {
      // Keep the rendered DOM and reading position until the reader accepts the new edition.
      $('apply-update').hidden = selected !== 'latest' || manifest.editions[0].file === displayedVersion;
      if (Date.now() - Date.parse(current.generatedAt) > 86400000) renderStatusOnly();
    }
  } catch { errorStatus(current ? '暂时无法检查更新，仍显示已读取的简报。' : '暂时无法读取简报。请稍后刷新；若首次部署，请先运行采集任务。'); }
  finally { checking = false; }
}
function renderStatusOnly() {
  if (!$('status').textContent.includes('超过24小时')) errorStatus(`本期已超过24小时，内容可能过期。 ${current.notice || ''}`);
}
$('filters').addEventListener('click', event => {
  const button = event.target.closest('button[data-category]');
  if (!button || !current) return;
  category = button.dataset.category;
  document.querySelectorAll('#filters button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  renderNews();
});
$('edition').addEventListener('change', async () => {
  const prior = selected;
  selected = $('edition').value;
  try { await loadEdition(); } catch { selected = prior; $('edition').value = prior; errorStatus('该期简报读取失败，请重试。'); }
});
$('apply-update').addEventListener('click', async () => {
  try { await loadEdition(); } catch { errorStatus('新一期读取失败，仍保留当前简报。'); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
window.addEventListener('focus', check);
setInterval(() => { if (!document.hidden) check(); }, 300000);
check();
