// 临时诊断脚本：全局牌数守恒检查（所有区域的牌加起来必须恒为 137）
const { LocalGame } = require('./public/js/engine.js');
let N = 0, bad = 0, stop = false;
const g = new LocalGame({
  zuizi: 10, delay: 0, onEmit: (ev, data) => {
    if (stop) return;
    if (ev === 'selfActions') {
      const acts = data.actions;
      if (acts.some(a => a.type === 'zimo')) g.handleEmit('zimo');
      else if (acts.some(a => a.type === 'ting')) { const t = acts.find(a => a.type === 'ting'); g.handleEmit('ting', { discardTileId: t.info.options[0].discardTileId }); }
      else if (acts.some(a => a.type === 'angang')) { const t = acts.find(a => a.type === 'angang'); g.handleEmit('angang', { tileKey: t.tileKey }); }
      else if (acts.some(a => a.type === 'bugang')) { const t = acts.find(a => a.type === 'bugang'); g.handleEmit('bugang', { tileKey: t.tileKey }); }
      else { const last = g.players[0].lastDrawTile; const id = last ? last.id : (g.players[0].handTiles[0] && g.players[0].handTiles[0].id); if (id != null) g.handleEmit('discard', { tileId: id }); }
    } else if (ev === 'availableActions') {
      if (data.actions.some(a => a.type === 'hu')) g.handleEmit('hu'); else g.handleEmit('pass');
    } else if (ev === 'gameOver') {
      N++;
      if (N < 5000) g.handleEmit('newRound'); else { console.log('完成 ' + N + ' 局，守恒违例 ' + bad + ' 次'); process.exit(0); }
    }
  }
});

const total = () => {
  let n = g.wallTiles.length + g.discardTiles.length;
  for (let s = 0; s < 4; s++) {
    const p = g.players[s]; if (!p) continue;
    n += p.handTiles.length + p.huaTiles.length;
    for (const pa of p.pengArea) n += pa.tiles.length;
    for (const ga of p.gangArea) n += ga.tiles.length;
  }
  return n;
};
let handBad = 0;
const check = (tag) => {
  if (stop) return;
  // 手牌数不变量：13 - 3*(碰+杠)，摸牌后 +1
  for (let s = 0; s < 4; s++) {
    const p = g.players[s]; if (!p) continue;
    const expect = 13 - 3 * (p.pengArea.length + p.gangArea.length);
    const n = p.handTiles.length;
    if (n !== expect && n !== expect + 1) {
      handBad++;
      if (handBad <= 1) {
        console.log('[手牌数违例] ' + tag + ' 第' + (N + 1) + '局 seat=' + s + ' hand=' + n + ' 期望=' + expect + '/' + (expect + 1) + ' 碰=' + p.pengArea.length + ' 杠=' + p.gangArea.length + ' 牌墙=' + g.wallTiles.length);
        console.log(new Error('stack').stack.split('\n').slice(2, 9).join('\n'));
      }
    }
  }
  const t = total();
  if (t !== 137) {
    bad++;
    if (bad === 1) {
      console.log('[守恒违例] ' + tag + ' 第' + (N + 1) + '局 总牌数=' + t + ' (应137)');
      console.log('  牌墙=' + g.wallTiles.length + ' 弃牌堆=' + g.discardTiles.length);
      for (let s = 0; s < 4; s++) {
        const p = g.players[s];
        console.log('  seat' + s + ' 手=' + p.handTiles.length + ' 花=' + p.huaTiles.length + ' 碰=' + p.pengArea.length + ' 杠=' + p.gangArea.length + (s === g.dealer ? ' [庄]' : ''));
      }
      stop = true; process.exit(1);
    }
  }
};
for (const m of ['peng', 'mingGang', 'anGang', 'buGang', 'drawTile', 'discardTile', '_dealTiles', '_checkAndReplaceHua']) {
  const orig = g[m].bind(g);
  g[m] = function (...a) { const r = orig(...a); check(m); return r; };
}

process.on('uncaughtException', e => { console.log('崩溃于第 ' + (N + 1) + ' 局: ' + e.message + '\n' + e.stack.split('\n')[1]); process.exit(1); });
g.start();
setTimeout(() => { console.log('超时, 已完成 ' + N + ' 局，守恒违例 ' + bad + ' 次，手牌数违例 ' + handBad + ' 次'); process.exit(0); }, 25000);
