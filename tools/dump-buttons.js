'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'file:///' + project.replace(/\\/g, '/') + '/index.html?debug=1';
const args = [
  '--headless=new',
  '--use-angle=d3d11',
  '--enable-gpu',
  '--window-size=1920,1080',
  '--allow-file-access-from-files',
  '--virtual-time-budget=15000',
  '--dump-dom',
  url,
];
const out = execFileSync(CHROME, args, {
  encoding: 'utf8',
  timeout: 60000,
  maxBuffer: 50 * 1024 * 1024,
});
const m = out.match(/<pre[^>]*id="flap-debug"[^>]*>([\s\S]*?)<\/pre>/);
if (!m) {
  console.log('NO DEBUG');
  process.exit(1);
}
const html = m[1]
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const dbg = JSON.parse(html);
console.log(JSON.stringify(dbg.buttons, null, 2));
console.log('textures', dbg.textures, 'frames', dbg.frames, 'fontLoaded', dbg.atlas);
