// 验证新开局流程：先掷骰子定庄（此时无手牌），点击确认后才发牌
process.env.PORT = 3999;
const path = require('path');
require(path.join(__dirname, 'server.js'));

const { io } = require(path.join(__dirname, 'node_modules', 'socket.io-client'));
const URL = 'http://localhost:3999';

const log = [];
let fail = false;
function check(cond, msg) {
  log.push((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) fail = true;
}

const a = io(URL, { forceNew: true });

const state = { gotGameStart: false, handBeforeConfirm: false, confirmSent: false, dealtHand: 0, gotYourTurn: false, gotDiscard: false };

a.on('connect', () => {
  a.emit('createRoom', { zuizi: 10, name: '测试A' });
});

a.on('joinedRoom', () => {
  // 补 3 个 AI 凑满 4 人
  a.emit('addAI');
  a.emit('addAI');
  a.emit('addAI');
  setTimeout(() => a.emit('ready'), 300);
});

a.on('gameStart', (d) => {
  state.gotGameStart = true;
  log.push('gameStart diceResults.len=' + (d.diceResults ? d.diceResults.length : 0));
  if (d.diceResults && d.diceResults.length) {
    // 第一盘：应带骰子结果，且此时尚未发牌
    check(true, '第一盘 gameStart 带骰子结果');
    // 模拟玩家点击“开始掷骰”
    setTimeout(() => {
      state.confirmSent = true;
      a.emit('confirmDice');
      log.push('emit confirmDice');
    }, 200);
  } else {
    check(false, '第一盘应带骰子结果，但 diceResults 为空');
  }
});

a.on('gameState', (s) => {
  const handLen = (s.myHand ? s.myHand.length : 0);
  // 在点击确认“之前”，不应出现有手牌的状态
  if (!state.confirmSent && handLen > 0) {
    state.handBeforeConfirm = true;
  }
  if (state.confirmSent && handLen > 0 && state.dealtHand === 0) {
    state.dealtHand = handLen;
    log.push('发牌后手牌数=' + handLen);
  }
});

a.on('yourTurn', () => {
  state.gotYourTurn = true;
  log.push('yourTurn (发牌后轮到出牌)');
});

a.on('tileDiscarded', () => {
  state.gotDiscard = true;
  log.push('tileDiscarded (发牌后有人出牌，对局已开始)');
});

setTimeout(() => {
  check(state.gotGameStart, '收到 gameStart');
  check(!state.handBeforeConfirm, '发牌前(确认掷骰前)桌面无手牌 —— 顺序正确');
  check(state.confirmSent, '已向服务端确认掷骰');
  check(state.dealtHand === 14 || state.dealtHand === 13, '确认后收到发牌(手牌13/14张): ' + state.dealtHand);
  // 发牌后“对局开始”：若人类是庄家则收到 yourTurn，否则 AI 庄家应已出牌（tileDiscarded）
  check(state.gotYourTurn || state.gotDiscard, '发牌后对局已开始(庄家出牌或轮到人类)');

  console.log('\n--- 流程日志 ---');
  log.forEach(l => console.log('  ' + l));
  console.log('\n结果: ' + (fail ? '❌ 失败' : '✅ 通过'));
  process.exit(fail ? 1 : 0);
}, 6000);
