// 新局流程测试：1真人+3AI 打完一局后，真人开新局，确认能再开一局
const io = require('socket.io-client');
const socket = io('http://localhost:3000');

let gameCount = 0;
let newRoundRequested = false;

socket.on('connect', () => {
  console.log('已连接服务器');
  socket.emit('createRoom', { zuizi: 10, name: '新局测试' });
});

socket.on('joinedRoom', (data) => {
  console.log('加入房间:', data.roomId, '座位:', data.seat);
  setTimeout(() => socket.emit('addAI'), 200);
  setTimeout(() => socket.emit('addAI'), 400);
  setTimeout(() => socket.emit('addAI'), 600);
  setTimeout(() => socket.emit('ready'), 1000);
});

socket.on('gameStart', (data) => {
  gameCount++;
  console.log(`>>> 第 ${gameCount} 局开始，庄家:`, data.dealer);
  if (gameCount >= 2) {
    console.log('✅ 新局成功开启！测试通过');
    setTimeout(() => { socket.disconnect(); process.exit(0); }, 1000);
  }
});

socket.on('gameState', (state) => {
  socket._lastState = state;
  if (gameCount >= 2) return; // 第二局只确认开始即可
  if (state.currentPlayer === 0 && state.myHand && state.myHand.length > 0 && !socket._discarding) {
    socket._discarding = true;
    setTimeout(() => {
      socket._discarding = false;
      if (!socket._lastState || !socket._lastState.myHand) return;
      const hand = socket._lastState.myHand;
      const tile = hand[Math.floor(Math.random() * hand.length)];
      socket.emit('discard', { tileId: tile.id });
    }, 600);
  }
});

socket.on('availableActions', () => setTimeout(() => socket.emit('pass'), 400));

socket.on('gameOver', (data) => {
  const wname = data.winType === 'draw' ? '荒庄' : data.players[data.winner].name;
  console.log('第一局结束:', wname, data.winType);
  if (!newRoundRequested) {
    newRoundRequested = true;
    setTimeout(() => {
      console.log('>>> 真人请求开新局 (newRound)');
      socket.emit('newRound');
    }, 800);
  }
});

socket.on('error', (data) => console.log('错误:', data.message));

setTimeout(() => { console.log('测试超时'); process.exit(1); }, 150000);
