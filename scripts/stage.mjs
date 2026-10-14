import { cp, mkdir, readFile, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist/data/editions', { recursive: true });
for (const name of ['index.html', 'app.js', 'style.css', 'icon.svg']) await cp(`public/${name}`, `dist/${name}`);
await cp('public/data/index.json', 'dist/data/index.json');
const index = JSON.parse(await readFile('public/data/index.json', 'utf8'));
for (const e of index.editions) {
  if (!/^editions\/[\d-]+\.json$/.test(e.file)) throw new Error('Invalid archive path');
  await cp(`public/data/${e.file}`, `dist/data/${e.file}`);
}
