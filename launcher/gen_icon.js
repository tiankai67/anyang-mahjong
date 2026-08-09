// 用 @resvg/resvg-js 把“发财”牌 (6z.svg) 栅格化为透明背景 PNG（高分辨率）
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.resolve(__dirname, '..');
const svgPath = path.join(ROOT, 'public', 'tiles', '6z.svg');
const outPath = path.join(__dirname, '_facai_tile.png');

const svg = fs.readFileSync(svgPath, 'utf8');
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 512 },
  background: 'rgba(0,0,0,0)'
});
const png = resvg.render();
fs.writeFileSync(outPath, png.asPng());
console.log('tile png ->', outPath, png.width + 'x' + png.height);
