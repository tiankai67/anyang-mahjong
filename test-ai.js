// AI 组局测试：1真人 + 3AI，自动完成一局
const io = require('socket.io-client');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('已连接服务器');
  socket.emit('createRoom', { zuizi: 10, name: '测试玩家' });
});

socket.on('joinedRoom', (data) => {
  console.log('加入房间:', data.roomId, '座位:', data.seat);
  // 添加3个AI
  setTimeout(() => socket.emit('addAI'), 200);
  setTimeout(() => socket.emit('addAI'), 400);
  setTimeout(() => socket.emit('addAI'), 600);
  // 准备
  setTimeout(() => socket.emit('ready'), 1000);
});

socket.on('roomInfo', (info) => {
  const humans = info.players.filter(p => p.name && !p.isAI).length;
  const ais = info.players.filter(p => p.name && p.isAI).length;
  const ready = info.players.filter(p => p.isReady).length;
  console.log(`房间状态 人:${humans} AI:${ais} 准备:${ready}/${info.players.length} 阶段:${info.phase}`);
});

socket.on('gameStart', (data) => {
  console.log('游戏开始，庄家:', data.dealer);
});

socket.on('yourTurn', (data) => {
  // 真人测试玩家自动随机出牌
  setTimeout(() => {
    const state = require('./src/roomManager').RoomManager ? null : null;
  }, 100);
});

socket.on('gameState', (state) => {
  // 保存最新状态
  socket._lastState = state;
  if (state.currentPlayer === 0 && state.myHand && state.myHand.length > 0) {
    // 轮到自己且还没出过牌，随机出一张
    if (!socket._discarding) {
      socket._discarding = true;
      setTimeout(() => {
        socket._discarding = false;
        if (!socket._lastState || !socket._lastState.myHand) return;
        const hand = socket._lastState.myHand;
        const tile = hand[Math.floor(Math.random() * hand.length)];
        console.log('测试玩家出牌:', tile.name);
        socket.emit('discard', { tileId: tile.id });
      }, 800);
    }
  }
});

socket.on('availableActions', (data) => {
  console.log('测试玩家收到可操作:', data.actions.map(a => a.type).join(','));
  // 自动过
  setTimeout(() => socket.emit('pass'), 500);
});

socket.on('selfActions', (data) => {
  console.log('测试玩家收到自操作:', data.actions.map(a => a.type).join(','));
  // 自动过（不报听/不杠/不自摸，方便测试AI流程）
  // 但自摸不点就会一直卡，这里让真人自动胡/报听/杠/出牌按之前逻辑
});

socket.on('tileDiscarded', (data) => {
  console.log(`${data.tile.name} 被玩家${data.player}打出`);
});

socket.on('pengOccurred', (data) => {
  console.log(`玩家${data.player} 碰！`);
});

socket.on('gangOccurred', (data) => {
  console.log(`玩家${data.player} ${data.type === 'an' ? '暗杠' : data.type === 'bugang' ? '补杠' : '明杠'}！`);
});

socket.on('tenpaiReported', (data) => {
  console.log(`玩家${data.player} 报听！`);
});

socket.on('gameOver', (data) => {
  if (data.winType === 'draw') {
    console.log('荒庄');
  } else {
    const wname = data.players[data.winner].name;
    console.log(`游戏结束，赢家: ${wname} ${data.winType === 'zimo' ? '自摸' : '点炮'}`);
  }
  console.log('分数:', data.players.map(p => p ? `${p.name}:${p.totalScore}` : '').filter(Boolean).join(' '));
  setTimeout(() => {
    console.log('测试完成，断开');
    socket.disconnect();
    process.exit(0);
  }, 2000);
});

socket.on('error', (data) => {
  console.log('错误:', data.message);
});

setTimeout(() => {
  console.log('测试超时');
  process.exit(1);
}, 120000);
