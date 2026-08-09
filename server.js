// 安阳麻将在线游戏服务器
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { RoomManager, PHASE } = require('./src/roomManager');
const ai = require('./src/ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const roomManager = new RoomManager();

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 昵称随机生成
const adjectives = ['快乐的', '幸运的', '无敌的', '潇洒的', '神秘的', '热情的', '冷静的', '霸气的'];
const nouns = ['玩家', '麻将手', '赌神', '雀圣', '大侠', '高手', '新手', '老司机'];
function randomName() {
  return adjectives[Math.floor(Math.random() * adjectives.length)] +
         nouns[Math.floor(Math.random() * nouns.length)] +
         Math.floor(Math.random() * 1000);
}

io.on('connection', (socket) => {
  console.log('玩家连接:', socket.id);

  // 设置昵称
  socket.playerName = randomName();

  // 获取房间列表
  socket.on('getRooms', () => {
    socket.emit('roomList', roomManager.getAllRooms());
  });

  // 创建房间
  socket.on('createRoom', ({ zuizi, name }) => {
    const roomId = 'room_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
    const room = roomManager.createRoom(roomId, zuizi || 10);
    const playerName = name || socket.playerName;
    const seat = room.addPlayer(socket.id, playerName);
    socket.playerName = playerName;
    socket.roomId = roomId;
    socket.seat = seat;
    socket.join(roomId);
    socket.emit('joinedRoom', {
      roomId,
      seat,
      zuizi: room.zuizi,
      gameState: room.getGameState(seat)
    });
    _broadcastRoomInfo(roomId);
  });

  // 加入房间
  socket.on('joinRoom', ({ roomId, name }) => {
    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('error', { message: '房间不存在' });
      return;
    }
    if (room.getPlayerCount() >= 4) {
      socket.emit('error', { message: '房间已满' });
      return;
    }
    const playerName = name || socket.playerName;
    const seat = room.addPlayer(socket.id, playerName);
    socket.playerName = playerName;
    socket.roomId = roomId;
    socket.seat = seat;
    socket.join(roomId);
    socket.emit('joinedRoom', {
      roomId,
      seat,
      zuizi: room.zuizi,
      gameState: room.getGameState(seat)
    });
    _broadcastRoomInfo(roomId);
  });

  // 准备
  socket.on('ready', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    const p = room.players[seat];
    if (p && !p.isAI) {
      p.isReady = true;
      _broadcastRoomInfo(info.roomId);

      // 4人准备好自动开始
      if (room.allReady() && room.getPlayerCount() === 4) {
        _startGame(info.roomId);
      }
    }
  });

  // 添加 AI 玩家
  socket.on('addAI', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    // 只有房主或房间未满时允许添加
    if (room.getPlayerCount() >= 4) {
      socket.emit('error', { message: '房间已满' });
      return;
    }
    if (room.phase !== PHASE.WAITING && room.phase !== PHASE.FINISHED) {
      socket.emit('error', { message: '游戏进行中无法添加AI' });
      return;
    }
    room.addAIPlayer();
    _broadcastRoomInfo(info.roomId);

    // 4人准备好自动开始
    if (room.allReady() && room.getPlayerCount() === 4) {
      _startGame(info.roomId);
    }
  });

  // 取消准备
  socket.on('unready', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    const p = room.players[seat];
    if (p) {
      p.isReady = false;
      _broadcastRoomInfo(info.roomId);
    }
  });

  // 出牌
  socket.on('discard', ({ tileId }) => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room.currentPlayer !== seat) {
      socket.emit('error', { message: '不是你的回合' });
      return;
    }
    if (room.phase !== PHASE.PLAYING) return;

    const tile = room.discardTile(seat, tileId);
    if (!tile) {
      socket.emit('error', { message: '出牌失败' });
      return;
    }

    // 广播出牌
    io.to(info.roomId).emit('tileDiscarded', {
      player: seat,
      tile: { name: tile.name, type: tile.type, num: tile.num, id: tile.id }
    });

    // 检查其他玩家的碰/杠/胡
    _processDiscardReactions(info.roomId, seat, tile);
  });

  // 碰牌
  socket.on('peng', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room._actionPlayers && !room._actionPlayers.has(seat)) return;
    const success = room.peng(seat, room.lastDiscardPlayer);
    if (success) {
      _clearActionTimeout(info.roomId);
      room._actionPlayers = null;
      room._passedPlayers = new Set();
      room.currentPlayer = seat;
      io.to(info.roomId).emit('pengOccurred', {
        player: seat,
        fromPlayer: room.lastDiscardPlayer,
        tile: room.lastDiscard
      });
      _broadcastGameState(info.roomId);
      // 碰后需要出牌
      const p = room.players[seat];
      if (p) {
        if (p.isAI) {
          _scheduleAIPlay(info.roomId, seat);
        } else {
          io.to(p.id).emit('yourTurn', { mustDiscard: true });
        }
      }
    }
  });

  // 明杠
  socket.on('minggang', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room._actionPlayers && !room._actionPlayers.has(seat)) return;
    const success = room.mingGang(seat, room.lastDiscardPlayer);
    if (success) {
      _clearActionTimeout(info.roomId);
      room._actionPlayers = null;
      room._passedPlayers = new Set();
      room.currentPlayer = seat;
      io.to(info.roomId).emit('gangOccurred', {
        player: seat,
        type: 'ming',
        fromPlayer: room.lastDiscardPlayer
      });
      _broadcastGameState(info.roomId);
      // 杠后需要出牌（已补牌）
      const p = room.players[seat];
      if (p) {
        if (p.isAI) {
          _scheduleAIPlay(info.roomId, seat);
        } else {
          io.to(p.id).emit('yourTurn', { mustDiscard: true, afterGang: true });
        }
      }
    }
  });

  // 暗杠
  socket.on('angang', ({ tileKey }) => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room.currentPlayer !== seat) return;
    const success = room.anGang(seat, tileKey);
    if (success) {
      io.to(info.roomId).emit('gangOccurred', {
        player: seat,
        type: 'an'
      });
      _broadcastGameState(info.roomId);
      const p = room.players[seat];
      if (p) {
        if (p.isAI) {
          _scheduleAIPlay(info.roomId, seat);
        } else {
          io.to(p.id).emit('yourTurn', { mustDiscard: true, afterGang: true });
        }
      }
    }
  });

  // 补杠
  socket.on('bugang', ({ tileKey }) => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room.currentPlayer !== seat) return;
    const success = room.buGang(seat, tileKey);
    if (success) {
      io.to(info.roomId).emit('gangOccurred', {
        player: seat,
        type: 'bugang'
      });
      _broadcastGameState(info.roomId);
      const p = room.players[seat];
      if (p) {
        if (p.isAI) {
          _scheduleAIPlay(info.roomId, seat);
        } else {
          io.to(p.id).emit('yourTurn', { mustDiscard: true, afterGang: true });
        }
      }
    }
  });

  // 胡牌（点炮）
  socket.on('hu', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room._actionPlayers && !room._actionPlayers.has(seat)) return;
    _clearActionTimeout(info.roomId);
    room._actionPlayers = null;
    const result = room.handleHu(seat, room.lastDiscardPlayer, false);
    if (result) {
      io.to(info.roomId).emit('gameOver', {
        winner: seat,
        winType: 'dianpao',
        dianPaoPlayer: room.lastDiscardPlayer,
        huDetail: room.huDetail,
        netScores: result.netScores,
        players: room.players.map(p => p ? { name: p.name, seat: p.seat, score: p.score, totalScore: p.totalScore } : null),
        revealObj: _buildReveal(room, seat, room.lastDiscard)
      });
      _broadcastGameState(info.roomId);
    } else {
      socket.emit('error', { message: '无法胡牌' });
    }
  });

  // 自摸
  socket.on('zimo', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room.currentPlayer !== seat) return;
    const result = room.handleHu(seat, null, true);
    if (result) {
      io.to(info.roomId).emit('gameOver', {
        winner: seat,
        winType: 'zimo',
        huDetail: room.huDetail,
        netScores: result.netScores,
        players: room.players.map(p => p ? { name: p.name, seat: p.seat, score: p.score, totalScore: p.totalScore } : null),
        revealObj: _buildReveal(room, seat, null)
      });
      _broadcastGameState(info.roomId);
    } else {
      socket.emit('error', { message: '无法自摸' });
    }
  });

  // 报听
  socket.on('ting', ({ discardTileId }) => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room.currentPlayer !== seat) return;
    const success = room.reportTenpai(seat, discardTileId);
    if (success) {
      // 报听后打出牌
      const tile = room.discardTile(seat, discardTileId);
      io.to(info.roomId).emit('tenpaiReported', {
        player: seat,
        tile: tile ? { name: tile.name, type: tile.type, num: tile.num, id: tile.id } : null
      });
      _broadcastGameState(info.roomId);
      // 继续检查其他玩家
      _processDiscardReactions(info.roomId, seat, tile);
    } else {
      socket.emit('error', { message: '无法报听' });
    }
  });

  // 跳过操作
  socket.on('pass', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (!room._actionPlayers || !room._actionPlayers.has(seat)) return;
    // 标记该玩家已跳过
    if (!room._passedPlayers) room._passedPlayers = new Set();
    room._passedPlayers.add(seat);
    _checkAllPassed(info.roomId);
  });

  // 开始新盘（任意真人玩家均可开新局，避免庄家是AI时无人能开）
  socket.on('newRound', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    const { room, seat } = info;
    if (room.phase !== PHASE.FINISHED) return;
    const p = room.players[seat];
    if (!p || p.isAI) {
      socket.emit('error', { message: '只有玩家可以开始新局' });
      return;
    }
    // 重置准备状态（AI 保持准备）
    for (const pl of room.players) {
      if (pl && !pl.isAI) pl.isReady = false;
    }
    _startGame(info.roomId);
  });

  // 客户端确认掷骰定庄，服务端正式发牌
  socket.on('confirmDice', () => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    _onConfirmDice(info.roomId, socket, info.seat);
  });

  // 离开房间
  socket.on('leaveRoom', () => {
    _handleDisconnect(socket);
  });

  // 断线
  socket.on('disconnect', () => {
    _handleDisconnect(socket);
  });

  // 发送消息
  socket.on('chat', ({ message }) => {
    const info = roomManager.getRoomByPlayer(socket.id);
    if (!info) return;
    io.to(info.roomId).emit('chatMessage', {
      player: info.seat,
      name: socket.playerName,
      message,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    });
  });
});

// ============ 游戏流程控制 ============

function _startGame(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  room.startNewGame();

  if (room.diceResults && room.diceResults.length) {
    // 第一盘：已掷骰定庄，但“先掷骰 → 再发牌”——
    // 发牌延迟到客户端点击“开始掷骰”(confirmDice) 之后才真正进行
    room.phase = PHASE.ROLLING;
    io.to(roomId).emit('gameStart', {
      dealer: room.dealer,
      diceResults: room.diceResults,
      roundNumber: room.roundNumber
    });
  } else {
    // 第2盘起：庄家顺延，无需掷骰，直接发牌并开始
    room.dealTiles();
    io.to(roomId).emit('gameStart', {
      dealer: room.dealer,
      diceResults: [],
      roundNumber: room.roundNumber
    });
    _broadcastGameState(roomId);
    _notifyDealer(roomId);
  }
}

// 客户端点击“开始掷骰”确认后，服务端才真正发牌并开始对局
function _onConfirmDice(roomId, socket, seat) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  if (room.phase === PHASE.ROLLING) {
    // 首盘：正式发牌并通知庄家出牌
    room.dealTiles();
    _broadcastGameState(roomId);
    _notifyDealer(roomId);
  } else if (room.phase === PHASE.PLAYING && socket) {
    // 已发牌（迟到玩家在掷骰后才加入）：仅给该玩家补发当前完整状态，避免空桌面
    io.to(socket.id).emit('gameState', room.getGameState(seat));
  }
}

// 通知庄家出牌（首盘发牌后 / 第2盘直接发牌后共用）
function _notifyDealer(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  const dealer = room.players[room.dealer];
  if (!dealer) return;
  if (dealer.isAI) {
    _scheduleAIPlay(roomId, room.dealer);
  } else {
    io.to(dealer.id).emit('yourTurn', { mustDiscard: true });
    // 检查自摸/暗杠等
    const actions = room.getSelfActions(room.dealer);
    if (actions.length > 0) {
      io.to(dealer.id).emit('selfActions', { actions });
    }
  }
}

function _nextTurn(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room || room.phase !== PHASE.PLAYING) return;

  room.nextPlayer();
  const seat = room.currentPlayer;
  const tile = room.drawTile(seat);

  if (room.phase === PHASE.FINISHED) {
    // 荒庄
    io.to(roomId).emit('gameOver', {
      winner: -1,
      winType: 'draw',
      netScores: {},
      players: room.players.map(p => p ? { name: p.name, seat: p.seat, score: 0, totalScore: p.totalScore } : null),
      revealObj: _buildReveal(room, -1, null)
    });
    _broadcastGameState(roomId);
    return;
  }

  _broadcastGameState(roomId);

  // 通知当前玩家
  const p = room.players[seat];
  if (p) {
    if (p.isAI) {
      _scheduleAIPlay(roomId, seat);
    } else {
      io.to(p.id).emit('yourTurn', { mustDiscard: true, drewTile: true });
      // 检查自摸/暗杠/报听
      const actions = room.getSelfActions(seat);
      if (actions.length > 0) {
        io.to(p.id).emit('selfActions', { actions });
      }
    }
  }
}

function _broadcastGameState(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  for (let i = 0; i < 4; i++) {
    if (room.players[i]) {
      io.to(room.players[i].id).emit('gameState', room.getGameState(i));
    }
  }
}

// 构建“亮牌”数据：一局结束后把所有玩家的手牌/碰杠/花牌发给客户端（含胡牌那张）
function _buildReveal(room, winnerSeat, extraTile) {
  const map = {};
  for (let i = 0; i < 4; i++) {
    const p = room.players[i];
    if (!p) continue;
    const hand = p.handTiles.map(t => ({
      type: t.type, num: t.num, id: t.id, name: t.name, isHua: !!t.isHua
    }));
    let winTileId = null;
    if (i === winnerSeat) {
      if (extraTile) {
        // 点炮：胡的那张牌在弃牌堆，补进手牌展示
        hand.push({ type: extraTile.type, num: extraTile.num, id: extraTile.id, name: extraTile.name, isHua: false });
        winTileId = extraTile.id;
      } else if (p.lastDrawTile) {
        // 自摸：胡的那张已是最新摸到的牌
        winTileId = p.lastDrawTile.id;
      }
    }
    map[i] = {
      seat: i,
      isWinner: (i === winnerSeat),
      winTileId,
      handTiles: hand,
      pengArea: p.pengArea,
      gangArea: p.gangArea,
      huaTiles: p.huaTiles.map(t => ({ type: t.type, num: t.num, id: t.id, name: t.name }))
    };
  }
  return map;
}

// 处理某张牌打出后其他玩家的响应（人类+AI）
function _processDiscardReactions(roomId, fromSeat, tile) {
  const room = roomManager.getRoom(roomId);
  if (!room || room.phase !== PHASE.PLAYING) return;

  const actions = {};
  let hasAction = false;
  for (let i = 0; i < 4; i++) {
    if (i === fromSeat || !room.players[i]) continue;
    const available = room.getAvailableActions(i);
    if (available.length > 0) {
      actions[i] = available;
      hasAction = true;
    }
  }

  if (!hasAction) {
    _nextTurn(roomId);
    return;
  }

  // 记录有操作权的玩家
  room._actionPlayers = new Set(Object.keys(actions).map(s => parseInt(s)));
  room._passedPlayers = new Set();

  // 通知人类玩家
  for (const s of Object.keys(actions)) {
    const targetSeat = parseInt(s);
    const p = room.players[targetSeat];
    if (p && !p.isAI) {
      io.to(p.id).emit('availableActions', { actions: actions[s], tile });
    }
  }

  // 安排 AI 延迟响应（给人类玩家先操作的机会）
  for (const s of Object.keys(actions)) {
    const targetSeat = parseInt(s);
    const p = room.players[targetSeat];
    if (p && p.isAI) {
      _scheduleAIReact(roomId, targetSeat);
    }
  }

  // 设置超时
  _setActionTimeout(roomId, fromSeat);
}

// 安排 AI 摸牌后操作
function _scheduleAIPlay(roomId, seat) {
  const room = roomManager.getRoom(roomId);
  if (!room || !room.players[seat] || !room.players[seat].isAI) return;
  const delay = 1200 + Math.floor(Math.random() * 1500);
  setTimeout(() => {
    _executeAIAction(roomId, seat, ai.decideAIPlay(room, seat));
  }, delay);
}

// 安排 AI 对他人出牌的响应
function _scheduleAIReact(roomId, seat) {
  const room = roomManager.getRoom(roomId);
  if (!room || !room.players[seat] || !room.players[seat].isAI) return;
  const delay = 1500 + Math.floor(Math.random() * 1200);
  setTimeout(() => {
    // 状态可能已经改变（人类玩家已操作）
    if (room.phase !== PHASE.PLAYING) return;
    if (!room._actionPlayers || !room._actionPlayers.has(seat)) return;
    const action = ai.decideAIReact(room, seat);
    if (action.type === 'pass') {
      room._passedPlayers.add(seat);
      _checkAllPassed(roomId);
    } else {
      _executeAIAction(roomId, seat, action);
    }
  }, delay);
}

// 检查是否所有有操作权的玩家都跳过了
function _checkAllPassed(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room || !room._actionPlayers) return;
  for (const s of room._actionPlayers) {
    if (!room._passedPlayers.has(s)) return;
  }
  // 都跳过了
  _clearActionTimeout(roomId);
  room._passedPlayers = new Set();
  room._actionPlayers = null;
  _nextTurn(roomId);
}

// 执行 AI 动作
function _executeAIAction(roomId, seat, action) {
  const room = roomManager.getRoom(roomId);
  if (!room || room.phase !== PHASE.PLAYING) return;
  if (!action) return;

  switch (action.type) {
    case 'zimo': {
      const result = room.handleHu(seat, null, true);
      if (result) {
        _clearActionTimeout(roomId);
        io.to(roomId).emit('gameOver', {
          winner: seat,
          winType: 'zimo',
          huDetail: room.huDetail,
          netScores: result.netScores,
          players: room.players.map(p => p ? { name: p.name, seat: p.seat, score: p.score, totalScore: p.totalScore } : null),
          revealObj: _buildReveal(room, seat, null)
        });
        _broadcastGameState(roomId);
      }
      break;
    }
    case 'hu': {
      _clearActionTimeout(roomId);
      const result = room.handleHu(seat, room.lastDiscardPlayer, false);
      if (result) {
        io.to(roomId).emit('gameOver', {
          winner: seat,
          winType: 'dianpao',
          dianPaoPlayer: room.lastDiscardPlayer,
          huDetail: room.huDetail,
          netScores: result.netScores,
          players: room.players.map(p => p ? { name: p.name, seat: p.seat, score: p.score, totalScore: p.totalScore } : null),
          revealObj: _buildReveal(room, seat, room.lastDiscard)
        });
        _broadcastGameState(roomId);
      }
      break;
    }
    case 'ting': {
      _clearActionTimeout(roomId);
      const success = room.reportTenpai(seat, action.discardTileId);
      if (success) {
        const tile = room.discardTile(seat, action.discardTileId);
        io.to(roomId).emit('tenpaiReported', {
          player: seat,
          tile: tile ? { name: tile.name, type: tile.type, num: tile.num, id: tile.id } : null
        });
        _broadcastGameState(roomId);
        _processDiscardReactions(roomId, seat, tile);
      }
      break;
    }
    case 'discard': {
      _clearActionTimeout(roomId);
      const tile = room.discardTile(seat, action.tileId);
      if (tile) {
        io.to(roomId).emit('tileDiscarded', {
          player: seat,
          tile: { name: tile.name, type: tile.type, num: tile.num, id: tile.id }
        });
        _broadcastGameState(roomId);
        _processDiscardReactions(roomId, seat, tile);
      }
      break;
    }
    case 'angang': {
      const success = room.anGang(seat, action.tileKey);
      if (success) {
        io.to(roomId).emit('gangOccurred', { player: seat, type: 'an' });
        _broadcastGameState(roomId);
        _scheduleAIPlay(roomId, seat);
      }
      break;
    }
    case 'bugang': {
      const success = room.buGang(seat, action.tileKey);
      if (success) {
        io.to(roomId).emit('gangOccurred', { player: seat, type: 'bugang' });
        _broadcastGameState(roomId);
        _scheduleAIPlay(roomId, seat);
      }
      break;
    }
    case 'minggang': {
      _clearActionTimeout(roomId);
      const success = room.mingGang(seat, room.lastDiscardPlayer);
      if (success) {
        room.currentPlayer = seat;
        io.to(roomId).emit('gangOccurred', { player: seat, type: 'ming' });
        _broadcastGameState(roomId);
        _scheduleAIPlay(roomId, seat);
      }
      break;
    }
    case 'peng': {
      _clearActionTimeout(roomId);
      const success = room.peng(seat, room.lastDiscardPlayer);
      if (success) {
        room.currentPlayer = seat;
        io.to(roomId).emit('pengOccurred', {
          player: seat,
          fromPlayer: room.lastDiscardPlayer,
          tile: room.lastDiscard
        });
        _broadcastGameState(roomId);
        // 碰后 AI 继续出牌
        _scheduleAIPlay(roomId, seat);
      }
      break;
    }
  }
}

function _broadcastRoomInfo(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit('roomInfo', {
    roomId,
    zuizi: room.zuizi,
    phase: room.phase,
    players: room.players.map((p, i) => ({
      seat: i,
      name: p ? p.name : '',
      isAI: p ? p.isAI : false,
      isReady: p ? p.isReady : false,
      isDealer: i === room.dealer,
      totalScore: p ? p.totalScore : 0,
      disconnected: p ? p.disconnected : false
    })),
    roundNumber: room.roundNumber
  });
}

// 操作超时处理
const actionTimeouts = {};

function _setActionTimeout(roomId, fromSeat) {
  _clearActionTimeout(roomId);
  actionTimeouts[roomId] = setTimeout(() => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    room._passedPlayers = new Set();
    room._actionPlayers = null;
    _nextTurn(roomId);
  }, 15000); // 15秒超时
}

function _clearActionTimeout(roomId) {
  if (actionTimeouts[roomId]) {
    clearTimeout(actionTimeouts[roomId]);
    delete actionTimeouts[roomId];
  }
}

function _handleDisconnect(socket) {
  const info = roomManager.getRoomByPlayer(socket.id);
  if (!info) return;
  const { roomId, room, seat } = info;

  // 如果移除该玩家后房间里没有真实玩家，直接清理房间（包括AI）
  const humanCount = room.players.filter(p => p && !p.isAI && p.id !== socket.id).length;
  if (humanCount === 0) {
    _clearActionTimeout(roomId);
    roomManager.removeRoom(roomId);
    return;
  }

  // 标记断线
  if (room.players[seat]) {
    room.players[seat].disconnected = true;
  }

  _broadcastRoomInfo(roomId);

  // 如果游戏中，通知其他玩家
  if (room.phase !== PHASE.WAITING && room.phase !== PHASE.FINISHED) {
    io.to(roomId).emit('playerDisconnected', { seat });
  }

  // 延迟移除（给重连时间）
  setTimeout(() => {
    const r = roomManager.getRoom(roomId);
    if (!r) return;
    if (r.players[seat] && r.players[seat].id === socket.id) {
      r.removePlayer(socket.id);
      // 任意玩家离开算新局
      r.dealer = -1;
      r.phase = PHASE.WAITING;
      _broadcastRoomInfo(roomId);
      // 如果房间没有真实玩家了，删除房间
      const remainingHuman = r.players.filter(p => p && !p.isAI).length;
      if (remainingHuman === 0) {
        _clearActionTimeout(roomId);
        roomManager.removeRoom(roomId);
      }
    }
  }, 30000); // 30秒后移除
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`安阳麻将服务器已启动: http://localhost:${PORT}`);
});
