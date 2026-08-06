// 引擎验证脚本：跑多局完整对局，验证算法与回合循环不崩溃
const { LocalGame, createAllTiles, canHu, isSevenPairs, getTenpai } = require('./public/js/engine.js');

// 1) 牌数校验
const all = createAllTiles();
console.log('牌总数 =', all.length, '(应为137)');

// 2) 胡牌/七对/听牌单元校验
const wan = (n) => ({ id: -1, type: 'wan', num: n, name: n + '万' });
const peng = (n) => ({ id: -1, type: 'tong', num: n, name: n + '筒' });
const zhong = () => ({ id: -1, type: 'jian', num: 1, name: '中' });
const tiao = (n) => ({ id: -1, type: 'tiao', num: n, name: n + '条' });
// 标准胡（14张）：123万 456万 789万 中中中 + 11筒(将)
const std = [wan(1), wan(2), wan(3), wan(4), wan(5), wan(6), wan(7), wan(8), wan(9), zhong(), zhong(), zhong(), peng(1), peng(1)];
console.log('标准胡(应true) =', canHu(std, 0, 0), '张数=' + std.length);
// 非胡牌（14张，故意差一张）
const bad = [wan(1), wan(2), wan(3), wan(4), wan(5), wan(6), wan(7), wan(8), wan(9), zhong(), zhong(), peng(1), peng(1), peng(5)];
console.log('非胡(应false) =', canHu(bad, 0, 0));
// 七对
const sp = [];
for (let n = 1; n <= 7; n++) { sp.push(wan(n)); sp.push({ id: -1, type: 'wan', num: n, name: n + '万' }); }
console.log('七对(应true) =', isSevenPairs(sp));
// 听牌（13张）：123万 456万 789万 11筒(将) + 23条 → 听 1条/4条
const tp = [wan(1), wan(2), wan(3), wan(4), wan(5), wan(6), wan(7), wan(8), wan(9), peng(1), peng(1), tiao(2), tiao(3)];
const tpList = getTenpai(tp, 0, 0);
console.log('听牌(应为 tiao_1 / tiao_4) =', tpList.map(t => t.key + ':' + t.type).join(', ') || '(空)');
// 碰牌后听牌（10张手牌+1碰）：123万 456万 11筒 + 23条
const tp2 = [wan(1), wan(2), wan(3), wan(4), wan(5), wan(6), peng(1), peng(1), tiao(2), tiao(3)];
console.log('碰后听牌数(应=2) =', getTenpai(tp2, 1, 0).length);

// 3) 完整跑 N 局（seat0 也自动出牌，模拟真人）
const N = parseInt(process.argv[2] || "8");
let finished = 0;
let totalTurns = 0;
const stat = {};
const g = new LocalGame({
  zuizi: 10,
  delay: 0,
  onEmit: (ev, data) => {
    if (ev === 'selfActions') {
      const acts = data.actions;
      if (acts.some(a => a.type === 'zimo')) g.handleEmit('zimo');
      else if (acts.some(a => a.type === 'ting')) { const t = acts.find(a => a.type === 'ting'); g.handleEmit('ting', { discardTileId: t.info.options[0].discardTileId }); }
      else if (acts.some(a => a.type === 'angang')) { const t = acts.find(a => a.type === 'angang'); g.handleEmit('angang', { tileKey: t.tileKey }); }
      else if (acts.some(a => a.type === 'bugang')) { const t = acts.find(a => a.type === 'bugang'); g.handleEmit('bugang', { tileKey: t.tileKey }); }
      else {
        // 模拟真人出牌：优先打刚摸的牌，碰牌后无摸牌则打第一张
        const last = g.players[0].lastDrawTile;
        const id = last ? last.id : (g.players[0].handTiles[0] && g.players[0].handTiles[0].id);
        if (id != null) g.handleEmit('discard', { tileId: id });
      }
    } else if (ev === 'availableActions') {
      const acts = data.actions;
      if (acts.some(a => a.type === 'hu')) g.handleEmit('hu');
      else g.handleEmit('pass');
    } else if (ev === 'gameOver') {
      finished++;
      stat[data.winType] = (stat[data.winType]||0)+1;
      // 校验分数守恒
      const sum = Object.values(data.netScores || {}).reduce((a, b) => a + b, 0);
      if (Math.abs(sum) > 0.001) console.log('  分数不守恒!', data.netScores);
      if (finished < N) g.handleEmit('newRound');
      else { console.log(`完成 ${N} 局，牌局类型统计=`, JSON.stringify(stat)); process.exit(0); }
    }
  }
});

g.start();

// 超时保护
setTimeout(() => { console.log('超时未完成，finished=', finished); process.exit(1); }, 20000);
