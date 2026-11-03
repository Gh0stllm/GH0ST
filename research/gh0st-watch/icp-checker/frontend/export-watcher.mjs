// Run after npm run build. Emit only the public files for the Netlify /watcher route.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const source=path.dirname(fileURLToPath(import.meta.url));
if (!process.argv[2]) throw Error('Supply an output directory for the watcher route.');
const dest=path.resolve(process.argv[2]);
await fs.mkdir(path.join(dest,'assets'),{recursive:true});
const html=(await fs.readFile(path.join(source,'index.html'),'utf8')).replace(/\b(href|src)="\/(?!\/)/g,'$1="/watcher/');
const css=(await fs.readFile(path.join(source,'dist','watch.css'),'utf8')).replace(/url\((["']?)\/assets\//g,'url($1/watcher/assets/');
await fs.writeFile(path.join(dest,'index.html'),html);
await fs.writeFile(path.join(dest,'watch.css'),css);
await fs.copyFile(path.join(source,'dist','watch.js'),path.join(dest,'watch.js'));
for (const asset of ['armillary.jpg','gh0st-watch-mark.svg','gh0st-watch-icon.svg','editorial-normal.woff2','editorial-italic.woff2','manrope.woff2','LICENSE-fraunces.txt','LICENSE-manrope.txt']) {
  await fs.copyFile(path.join(source,'assets',asset),path.join(dest,'assets',asset));
}
