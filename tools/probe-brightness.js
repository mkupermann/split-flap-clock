'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const shots = path.join(project, '.claude', 'shots');
const html = `<!DOCTYPE html><html><body><canvas id="c"></canvas><pre id="out"></pre>
<script>
function probe(src) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var c = document.getElementById('c');
      c.width = img.width; c.height = img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      function region(x, y, w, h) {
        x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
        w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
        var d = ctx.getImageData(x, y, w, h).data;
        var r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; n++; }
        return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
      }
      var W = img.width, H = img.height;
      resolve({
        size: [W, H],
        bgCorner: region(2, 2, 50, 50),
        timeArea: region(W*0.28, H*0.16, W*0.44, H*0.20),
        midRows: region(W*0.18, H*0.46, W*0.64, H*0.14),
        bottom: region(W*0.18, H*0.70, W*0.64, H*0.18),
        full: region(0, 0, W, H)
      });
    };
    img.onerror = function() { resolve({ error: 'load ' + src }); };
    img.src = src;
  });
}
probe('render-1920.png').then(function(a) {
  return probe('render-1366.png').then(function(b) {
    document.getElementById('out').textContent = JSON.stringify({ a: a, b: b });
  });
});
</script></body></html>`;
fs.writeFileSync(path.join(shots, 'probe.html'), html, 'utf8');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = 'file:///' + shots.replace(/\\/g, '/') + '/probe.html';
const out = execFileSync(
  CHROME,
  ['--headless=new', '--allow-file-access-from-files', '--virtual-time-budget=5000', '--dump-dom', url],
  { encoding: 'utf8', timeout: 40000, maxBuffer: 10 * 1024 * 1024 }
);
const m = out.match(/<pre id="out">([\s\S]*?)<\/pre>/);
console.log(m ? m[1] : out.slice(0, 800));
