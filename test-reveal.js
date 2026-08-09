// 端到端验证：一局结束后服务端是否把“亮牌”数据（各家完整手牌/碰杠/花牌+胡牌张）推给客户端
const { io } = require('socket.io-client');
const PORT = process.env.PORT || 3099;

let latestState = null;
const log = [];
let fail = false;
function check(cond, msg) {
  log.push((cond ? '✅ ' : '❌ ') + msg);
  if (!cond) fail = true;
}

const a = io('http://localhost:' + PORT, { transports: ['websocket'] });

a.on('connect', () => {
  a.emit('createRoom', { zuizi: 10, name: '测试员' });
});

a.on('joinedRoom', (d) => {
  // 补满 4 人（3 个 AI）
  for (let i = 0; i < 3; i++) a.emit('addAI');
  a.emit('ready');
});

a.on('gameStart', (d) => {
  // 首盘需点击“开始掷骰”确认发牌；后续盘直接发
  if (d.diceResults && d.diceResults.length) {
    setTimeout(() => a.emit('confirmDice'), 50);
  }
});

a.on('gameState', (s) => { latestState = s; });

a.on('yourTurn', (d) => {
  if (!latestState || !latestState.myHand || !latestState.myHand.length) return;
  // 简单策略：直接打出第一张，推动对局前进
  a.emit('discard', { tileId: latestState.myHand[0].id });
});

a.on('availableActions', () => { a.emit('pass'); });

a.on('selfActions', (acts) => {
  if (acts && acts.some(x => x.type === 'zimo')) {
    a.emit('zimo'); // 能自摸就自摸，加快结束
  }
});

a.on('gameOver', (data) => {
  log.push('--- 收到 gameOver (winType=' + data.winType + ', winner=' + data.winner + ') ---');
  const r = data.revealObj;
  check(!!r, 'gameOver 携带 revealObj（亮牌数据）');
  if (!r) return;
  let seatCount = 0, allHaveHand = true, winnerHasHu = true;
  for (let i = 0; i < 4; i++) {
    if (!r[i]) continue;
    seatCount++;
    if (!Array.isArray(r[i].handTiles) || r[i].handTiles.length === 0) allHaveHand = false;
    for (const t of r[i].handTiles) {
      if (typeof t.type !== 'string' || typeof t.num !== 'number') allHaveHand = false;
    }
    if (i === data.winner && data.winner >= 0) {
      if (!r[i].isWinner || !r[i].winTileId) winnerHasHu = false;
    }
  }
  check(seatCount === 4, 'revealObj 含全部 4 个座位');
  check(allHaveHand, '每位玩家都亮出了手牌（含 type/num 牌面）');
  if (data.winner >= 0) check(winnerHasHu, '胜者手牌标注了胡牌的那张（winTileId/isWinner）');
  else check(true, '荒庄：无胜者，仍亮出所有人手牌');

  // 打印各家手牌数量，便于人工核对
  for (let i = 0; i < 4; i++) {
    if (r[i]) log.push(`   座位${i}: 手牌 ${r[i].handTiles.length} 张, 碰 ${r[i].pengArea.length}, 杠 ${r[i].gangArea.length}, 财神 ${r[i].huaTiles.length}`);
  }
  finish();
});

function finish() {
  console.log(log.join('\n'));
  console.log('\n结果: ' + (fail ? '❌ 失败' : '✅ 通过'));
  a.close();
  process.exit(fail ? 1 : 0);
}

// 兜底超时：对局拖太久则报失败
setTimeout(() => {
  if (!log.some(l => l.includes('gameOver'))) {
    log.push('❌ 超时：一局未在限定时间内结束');
    fail = true;
    finish();
  }
}, 150000);
