// 安阳麻将房间管理与游戏状态机
const { createAllTiles, getTileKey, sortTiles, shuffleTiles, rollDice, isSameTile, TILE_TYPES } = require('./tiles');
const logic = require('./gameLogic');

// 游戏阶段
const PHASE = {
  WAITING: 'waiting',       // 等待玩家
  ROLLING: 'rolling',       // 摇骰子定庄
  DEALING: 'dealing',       // 发牌
  PLAYING: 'playing',       // 出牌中
  GANG_DRAW: 'gang_draw',   // 杠后补牌
  HUA_DRAW: 'hua_draw',     // 花牌补牌
  TENPAI_CHECK: 'tenpai_check', // 听牌检查(顶张)
  FINISHED: 'finished'      // 游戏结束
};

class GameRoom {
  constructor(roomId, zuizi = 10) {
    this.roomId = roomId;
    this.zuizi = zuizi; // zuizi金额
    this.players = [null, null, null, null]; // 4个座位
    this.spectators = []; // 观众
    this.phase = PHASE.WAITING;
    this.wallTiles = []; // 牌墙
    this.discardTiles = []; // 弃牌堆
    this.currentPlayer = 0; // 当前出牌玩家
    this.dealer = 0; // 庄家
    this.turnCount = 0;
    this.lastDiscard = null; // 最后出的牌
    this.lastDiscardPlayer = -1; // 最后出牌的玩家
    this.gangScores = {}; // 杠分记录
    this.gameLog = []; // 游戏日志
    this.diceResults = []; // 骰子结果
    this.winner = null; // 胜者
    this.winType = null; // 胡牌类型
    this.huDetail = null; // 胡牌详情
    this.roundNumber = 0; // 第几盘
  }

  // 玩家加入
  addPlayer(socketId, name, isAI = false) {
    for (let i = 0; i < 4; i++) {
      if (this.players[i] === null) {
        this.players[i] = {
          id: socketId,
          name: name,
          seat: i,
          isAI: isAI,
          isReady: isAI,     // AI 默认准备
          handTiles: [],     // 手牌
          pengArea: [],      // 碰区 [{tiles:[t1,t2,t3], fromTile, fromPlayer}]
          gangArea: [],      // 杠区 [{tiles:[t1,t2,t3,t4], type:'ming'|'an', fromPlayer}]
          huaTiles: [],      // 花牌(财神)
          isTenpai: false,   // 是否报听
          tenpaiInfo: null,  // 听牌信息
          hasHua: false,     // 是否有花牌
          isDealer: false,
          score: 0,          // 本局得分
          totalScore: 0,     // 总分
          disconnected: false,
          lastDrawTile: null // 最后摸的牌
        };
        return i;
      }
    }
    return -1; // 满了
  }

  // 添加 AI 玩家
  addAIPlayer() {
    const aiNames = ['电脑·东风', '电脑·南风', '电脑·西风', '电脑·北风', '电脑·红中', '电脑·发财', '电脑·白板'];
    let name = aiNames[Math.floor(Math.random() * aiNames.length)];
    let suffix = 1;
    const existingNames = new Set(this.players.filter(p => p).map(p => p.name));
    while (existingNames.has(name)) {
      name = aiNames[Math.floor(Math.random() * aiNames.length)] + suffix;
      suffix++;
    }
    const aiId = 'ai_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    return this.addPlayer(aiId, name, true);
  }

  // 玩家离开
  removePlayer(socketId) {
    for (let i = 0; i < 4; i++) {
      if (this.players[i] && this.players[i].id === socketId) {
        this.players[i] = null;
        return i;
      }
    }
    return -1;
  }

  // 获取玩家数量
  getPlayerCount() {
    return this.players.filter(p => p !== null).length;
  }

  // 所有玩家都准备好了
  allReady() {
    return this.players.every(p => p !== null && p.isReady);
  }

  // 开始新游戏
  startNewGame() {
    this.roundNumber++;
    this.phase = PHASE.ROLLING;
    this.wallTiles = [];
    this.discardTiles = [];
    this.lastDiscard = null;
    this.lastDiscardPlayer = -1;
    this.gangScores = {};
    this.winner = null;
    this.winType = null;
    this.huDetail = null;
    this.diceResults = [];
    this.gameLog = [];

    // 重置玩家状态
    for (const p of this.players) {
      if (p) {
        p.handTiles = [];
        p.pengArea = [];
        p.gangArea = [];
        p.huaTiles = [];
        p.isTenpai = false;
        p.tenpaiInfo = null;
        p.hasHua = false;
        p.score = 0;
        p.lastDrawTile = null;
      }
    }

    // 如果是第一局，需要摇骰子定庄
    if (this.roundNumber === 1 || this.dealer === -1) {
      this._rollForDealer();
    }
  }

  // 摇骰子定庄
  _rollForDealer() {
    const results = [];
    for (let i = 0; i < 4; i++) {
      if (this.players[i]) {
        const dice = rollDice();
        results.push({ seat: i, dice: dice[0] + dice[1], detail: dice });
      }
    }
    // 点数最大的为庄家
    results.sort((a, b) => b.dice - a.dice);
    this.dealer = results[0].seat;
    this.diceResults = results;

    // 只设置庄家标志，不交换座位（保持前端座位号稳定）
    for (let i = 0; i < 4; i++) {
      if (this.players[i]) {
        this.players[i].isDealer = (i === this.dealer);
      }
    }

    this.gameLog.push({ type: 'roll', results });
  }

  // 发牌
  dealTiles() {
    // 创建并洗牌
    const allTiles = createAllTiles();
    this.wallTiles = shuffleTiles(allTiles);

    // 庄家14张，闲家13张
    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      if (!p) continue;
      const count = (i === this.dealer) ? 14 : 13;
      p.handTiles = this.wallTiles.splice(0, count);
      p.handTiles = sortTiles(p.handTiles);
    }

    // 检查花牌
    this._checkHuaForAll();

    this.phase = PHASE.PLAYING;
    this.currentPlayer = this.dealer;
  }

  // 检查所有玩家的花牌
  _checkHuaForAll() {
    for (const p of this.players) {
      if (!p) continue;
      this._checkAndReplaceHua(p);
    }
  }

  // 检查并替换花牌
  _checkAndReplaceHua(player) {
    let foundHua = true;
    while (foundHua) {
      foundHua = false;
      for (let i = 0; i < player.handTiles.length; i++) {
        if (player.handTiles[i].isHua) {
          const hua = player.handTiles.splice(i, 1)[0];
          player.huaTiles.push(hua);
          player.hasHua = true;
          // 从牌墙尾部补牌
          if (this.wallTiles.length > 0) {
            const newTile = this.wallTiles.pop();
            player.handTiles.push(newTile);
            player.handTiles = sortTiles(player.handTiles);
          }
          foundHua = true;
          break;
        }
      }
    }
  }

  // 摸牌
  drawTile(seat) {
    if (this.wallTiles.length === 0) {
      // 荒庄
      this._handleDraw();
      return null;
    }
    const tile = this.wallTiles.shift();
    const p = this.players[seat];
    if (!p) return null;

    p.handTiles.push(tile);
    p.handTiles = sortTiles(p.handTiles);
    p.lastDrawTile = tile;

    // 检查花牌
    if (tile.isHua) {
      p.huaTiles.push(tile);
      p.handTiles.pop();
      p.hasHua = true;
      // 补牌
      if (this.wallTiles.length > 0) {
        const newTile = this.wallTiles.pop();
        p.handTiles.push(newTile);
        p.handTiles = sortTiles(p.handTiles);
        p.lastDrawTile = newTile;
        // 补到的牌也可能是花牌，递归检查
        if (newTile.isHua) {
          this._checkAndReplaceHua(p);
        }
      }
    }

    return tile;
  }

  // 出牌
  discardTile(seat, tileId) {
    const p = this.players[seat];
    if (!p) return null;

    const idx = p.handTiles.findIndex(t => t.id === tileId);
    if (idx === -1) return null;

    const tile = p.handTiles.splice(idx, 1)[0];
    p.lastDrawTile = null;
    this.lastDiscard = tile;
    this.lastDiscardPlayer = seat;
    this.discardTiles.push({ tile, player: seat });

    return tile;
  }

  // 碰牌
  peng(seat, fromSeat) {
    const p = this.players[seat];
    if (!p || !this.lastDiscard) return false;

    const tile = this.lastDiscard;
    const key = getTileKey(tile);

    // 从手牌中找2张相同的
    const matching = p.handTiles.filter(t => getTileKey(t) === key);
    if (matching.length < 2) return false;

    // 移除手牌中的2张
    for (let i = 0; i < 2; i++) {
      const idx = p.handTiles.findIndex(t => getTileKey(t) === key);
      p.handTiles.splice(idx, 1);
    }

    // 添加到碰区
    p.pengArea.push({
      tiles: [tile, matching[0], matching[1]],
      fromTile: tile,
      fromPlayer: fromSeat
    });

    // 从弃牌堆移除
    this.discardTiles.pop();

    return true;
  }

  // 明杠
  mingGang(seat, fromSeat) {
    const p = this.players[seat];
    if (!p || !this.lastDiscard) return false;

    const tile = this.lastDiscard;
    const key = getTileKey(tile);

    // 从手牌中找3张相同的
    const matching = p.handTiles.filter(t => getTileKey(t) === key);
    if (matching.length < 3) return false;

    // 移除手牌中的3张
    for (let i = 0; i < 3; i++) {
      const idx = p.handTiles.findIndex(t => getTileKey(t) === key);
      p.handTiles.splice(idx, 1);
    }

    // 添加到杠区
    p.gangArea.push({
      tiles: [tile, matching[0], matching[1], matching[2]],
      type: 'ming',
      fromPlayer: fromSeat
    });

    // 从弃牌堆移除
    this.discardTiles.pop();

    // 杠分：被杠者给杠者1zuizi
    this.gangScores[seat] = (this.gangScores[seat] || 0) + this.zuizi;
    this.gangScores[fromSeat] = (this.gangScores[fromSeat] || 0) - this.zuizi;

    // 补牌
    this._drawAfterGang(seat);

    return true;
  }

  // 暗杠
  anGang(seat, tileKey) {
    const p = this.players[seat];
    if (!p) return false;

    // 从手牌中找4张相同的
    const matching = p.handTiles.filter(t => getTileKey(t) === tileKey);
    if (matching.length < 4) return false;

    // 移除手牌中的4张
    for (let i = 0; i < 4; i++) {
      const idx = p.handTiles.findIndex(t => getTileKey(t) === tileKey);
      p.handTiles.splice(idx, 1);
    }

    // 添加到杠区
    p.gangArea.push({
      tiles: matching,
      type: 'an',
      fromPlayer: -1
    });

    // 杠分：每人给杠者2zuizi
    this.gangScores[seat] = (this.gangScores[seat] || 0) + this.zuizi * 2 * 3;
    for (let i = 0; i < 4; i++) {
      if (i !== seat && this.players[i]) {
        this.gangScores[i] = (this.gangScores[i] || 0) - this.zuizi * 2;
      }
    }

    // 补牌
    this._drawAfterGang(seat);

    return true;
  }

  // 补杠（碰过的牌又摸到第4张）
  buGang(seat, tileKey) {
    const p = this.players[seat];
    if (!p) return false;

    // 在碰区找
    const pengIdx = p.pengArea.findIndex(pa => getTileKey(pa.tiles[0]) === tileKey);
    if (pengIdx === -1) return false;

    // 从手牌中找1张
    const handIdx = p.handTiles.findIndex(t => getTileKey(t) === tileKey);
    if (handIdx === -1) return false;

    const tile = p.handTiles.splice(handIdx, 1)[0];
    const peng = p.pengArea.splice(pengIdx, 1)[0];

    // 添加到杠区
    p.gangArea.push({
      tiles: [...peng.tiles, tile],
      type: 'ming', // 补杠算明杠
      fromPlayer: peng.fromPlayer
    });

    // 杠分：被碰的玩家给杠者1zuizi
    this.gangScores[seat] = (this.gangScores[seat] || 0) + this.zuizi;
    this.gangScores[peng.fromPlayer] = (this.gangScores[peng.fromPlayer] || 0) - this.zuizi;

    // 补牌
    this._drawAfterGang(seat);

    return true;
  }

  // 杠后补牌
  _drawAfterGang(seat) {
    const p = this.players[seat];
    if (this.wallTiles.length > 0) {
      const tile = this.wallTiles.pop(); // 从尾部补
      p.handTiles.push(tile);
      p.handTiles = sortTiles(p.handTiles);
      p.lastDrawTile = tile;

      // 检查花牌
      if (tile.isHua) {
        p.huaTiles.push(tile);
        p.handTiles.pop();
        p.hasHua = true;
        if (this.wallTiles.length > 0) {
          const newTile = this.wallTiles.pop();
          p.handTiles.push(newTile);
          p.handTiles = sortTiles(p.handTiles);
          p.lastDrawTile = newTile;
        }
      }
    }
  }

  // 检查能否胡牌
  checkHu(seat, tile) {
    const p = this.players[seat];
    if (!p) return null;

    const testTiles = [...p.handTiles];
    if (tile && !testTiles.find(t => t.id === tile.id)) {
      testTiles.push(tile);
    }

    const pengCount = p.pengArea.length;
    const gangCount = p.gangArea.length;
    const canWin = logic.canHu(testTiles, pengCount, gangCount);

    if (!canWin) return null;

    // 获取胡牌类型
    const huTile = tile || p.lastDrawTile;
    const huType = logic.getHuType(testTiles, huTile, pengCount, gangCount);

    return { canHu: true, type: huType, tiles: testTiles, huTile };
  }

  // 检查能否自摸
  checkZimo(seat) {
    const p = this.players[seat];
    if (!p || !p.lastDrawTile) return null;
    return this.checkHu(seat, p.lastDrawTile);
  }

  // 检查能否点胡
  checkDianHu(seat) {
    // 只有报听的玩家才能被点胡
    // 点胡只能胡报听过的玩家
    if (!this.lastDiscard) return null;
    const p = this.players[seat];
    if (!p) return null;
    // 玩家自己必须报听才能胡别人的点炮
    if (!p.isTenpai) return null;
    return this.checkHu(seat, this.lastDiscard);
  }

  // 获取碰/杠/胡的可用操作
  getAvailableActions(seat) {
    const p = this.players[seat];
    if (!p) return [];

    const actions = [];

    // 检查能否碰
    if (this.lastDiscard && this.lastDiscardPlayer !== seat) {
      if (logic.canPeng(p.handTiles, this.lastDiscard)) {
        actions.push({ type: 'peng', tile: this.lastDiscard });
      }
      // 检查能否明杠
      if (logic.canMingGang(p.handTiles, this.lastDiscard)) {
        actions.push({ type: 'minggang', tile: this.lastDiscard });
      }
      // 检查能否点胡（必须报听）
      if (p.isTenpai) {
        const huResult = this.checkHu(seat, this.lastDiscard);
        if (huResult) {
          actions.push({ type: 'hu', tile: this.lastDiscard, huType: huResult.type });
        }
      }
    }

    return actions;
  }

  // 获取自己回合的可用操作（摸牌后）
  getSelfActions(seat) {
    const p = this.players[seat];
    if (!p) return [];

    const actions = [];

    // 检查能否自摸
    const zimo = this.checkZimo(seat);
    if (zimo) {
      actions.push({ type: 'zimo', huType: zimo.type });
    }

    // 检查暗杠
    const anGangOptions = logic.getAnGangOptions(p.handTiles);
    for (const key of anGangOptions) {
      actions.push({ type: 'angang', tileKey: key });
    }

    // 检查补杠
    const buGangOptions = logic.getBuGangOptions(p.handTiles, p.pengArea);
    for (const key of buGangOptions) {
      actions.push({ type: 'bugang', tileKey: key });
    }

    // 检查能否报听（顶张机制）
    if (!p.isTenpai) {
      const tenpai = this._checkTenpaiWithDingZhang(seat);
      if (tenpai.canReport) {
        actions.push({ type: 'ting', info: tenpai });
      }
    }

    return actions;
  }

  // 顶张听牌检查
  // 规则：摸到一张可替代手牌中任意一张的牌时，打出被替代的牌，然后报听
  _checkTenpaiWithDingZhang(seat) {
    const p = this.players[seat];
    if (!p || !p.lastDrawTile) return { canReport: false };

    // lastDrawTile 是顶张
    // 检查：打出任意一张牌后，是否能听牌
    const dingZhang = p.lastDrawTile;
    const dingKey = getTileKey(dingZhang);

    // 顶张只能摸起，不能碰杠
    // 顶张可与手牌中的牌相同，也可与手牌组合

    // 尝试打出每张牌，检查是否能听牌
    const reportable = [];

    for (let i = 0; i < p.handTiles.length; i++) {
      const testHand = [...p.handTiles];
      testHand.splice(i, 1);
      
      const pengCount = p.pengArea.length;
      const gangCount = p.gangArea.length;
      const tenpai = logic.getTenpai(testHand, pengCount, gangCount);
      
      if (tenpai.length > 0) {
        reportable.push({
          discardTileId: p.handTiles[i].id,
          discardTileKey: getTileKey(p.handTiles[i]),
          tenpaiTiles: tenpai
        });
      }
    }

    if (reportable.length > 0) {
      return {
        canReport: true,
        dingZhang: dingZhang,
        options: reportable
      };
    }

    return { canReport: false };
  }

  // 报听
  reportTenpai(seat, discardTileId) {
    const p = this.players[seat];
    if (!p) return false;

    const check = this._checkTenpaiWithDingZhang(seat);
    if (!check.canReport) return false;

    // 找到对应的选项
    const option = check.options.find(o => o.discardTileId === discardTileId);
    if (!option) return false;

    p.isTenpai = true;
    p.tenpaiInfo = {
      dingZhang: p.lastDrawTile,
      discardTileId: discardTileId,
      tenpaiTiles: option.tenpaiTiles
    };

    return true;
  }

  // 胡牌结算
  handleHu(winnerSeat, dianPaoSeat, isZimo) {
    const winner = this.players[winnerSeat];
    if (!winner) return null;

    const huResult = isZimo ? this.checkZimo(winnerSeat) : this.checkHu(winnerSeat, this.lastDiscard);
    if (!huResult) return null;

    const isZhuang = winnerSeat === this.dealer;
    const hasHua = winner.hasHua;
    const huType = huResult.type;

    const players = this.players.filter(p => p !== null).map(p => ({
      id: p.seat,
      isZhuang: p.seat === this.dealer
    }));

    const scoreResult = logic.calculateScore({
      winner: winnerSeat,
      dianPaoPlayer: dianPaoSeat,
      isZhuang,
      isZimo,
      hasHua,
      huType,
      gangScores: this.gangScores,
      zuizi: this.zuizi,
      players
    });

    // 更新分数
    for (const pid of Object.keys(scoreResult.netScores)) {
      const seat = parseInt(pid);
      if (this.players[seat]) {
        this.players[seat].score = scoreResult.netScores[pid];
        this.players[seat].totalScore += scoreResult.netScores[pid];
      }
    }

    this.winner = winnerSeat;
    this.winType = isZimo ? 'zimo' : 'dianpao';
    this.huDetail = { huType, hasHua, isZhuang, dianPaoSeat, transactions: scoreResult.transactions };
    this.phase = PHASE.FINISHED;

    // 庄家连庄/闲家接庄
    // 规则：庄家胡牌(自摸或点炮)→连庄，闲家胡牌→庄家的下家坐庄
    if (winnerSeat !== this.dealer) {
      // 闲家胡牌，庄家的下家坐庄
      this.dealer = (this.dealer + 1) % 4;
      while (!this.players[this.dealer]) {
        this.dealer = (this.dealer + 1) % 4;
      }
    }
    // 庄家胡牌 → 连庄（dealer不变）

    return scoreResult;
  }

  // 荒庄
  _handleDraw() {
    this.phase = PHASE.FINISHED;
    this.winType = 'draw';
    this.winner = -1;
    // 荒庄不结算杠分
    // 庄家连庄
  }

  // 获取剩余牌数
  getRemainingTiles() {
    return this.wallTiles.length;
  }

  // 获取游戏状态（用于发送给客户端）
  getGameState(seat) {
    const p = this.players[seat];
    if (!p) return null;

    return {
      phase: this.phase,
      currentPlayer: this.currentPlayer,
      dealer: this.dealer,
      remainingTiles: this.wallTiles.length,
      discardTiles: this.discardTiles,
      lastDiscard: this.lastDiscard,
      lastDiscardPlayer: this.lastDiscardPlayer,
      myHand: p.handTiles,
      myPengArea: p.pengArea,
      myGangArea: p.gangArea,
      myHuaTiles: p.huaTiles,
      isTenpai: p.isTenpai,
      tenpaiInfo: p.tenpaiInfo,
      hasHua: p.hasHua,
      lastDrawTile: p.lastDrawTile,
      roundNumber: this.roundNumber,
      zuizi: this.zuizi,
      players: this.players.map((pl, i) => ({
        seat: i,
        name: pl ? pl.name : '',
        isAI: pl ? pl.isAI : false,
        tileCount: pl ? pl.handTiles.length : 0,
        pengCount: pl ? pl.pengArea.length : 0,
        gangCount: pl ? pl.gangArea.length : 0,
        huaCount: pl ? pl.huaTiles.length : 0,
        isDealer: i === this.dealer,
        isTenpai: pl ? pl.isTenpai : false,
        score: pl ? pl.score : 0,
        totalScore: pl ? pl.totalScore : 0,
        pengArea: pl ? pl.pengArea : [],
        gangArea: pl ? pl.gangArea : [],
        disconnected: pl ? pl.disconnected : false
      }))
    };
  }

  // 下一个玩家
  nextPlayer() {
    this.currentPlayer = (this.currentPlayer + 1) % 4;
    while (!this.players[this.currentPlayer]) {
      this.currentPlayer = (this.currentPlayer + 1) % 4;
    }
    this.turnCount++;
  }
}

// 房间管理器
class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(roomId, zuizi) {
    const room = new GameRoom(roomId, zuizi);
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  removeRoom(roomId) {
    this.rooms.delete(roomId);
  }

  getRoomByPlayer(socketId) {
    for (const [id, room] of this.rooms) {
      for (const p of room.players) {
        if (p && p.id === socketId) return { roomId: id, room, seat: p.seat };
      }
    }
    return null;
  }

  getAllRooms() {
    const list = [];
    for (const [id, room] of this.rooms) {
      list.push({
        roomId: id,
        playerCount: room.getPlayerCount(),
        zuizi: room.zuizi,
        phase: room.phase
      });
    }
    return list;
  }
}

module.exports = { GameRoom, RoomManager, PHASE };
