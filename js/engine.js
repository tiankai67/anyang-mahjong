// 安阳麻将 —— 纯前端单机引擎（浏览器内运行，无需服务器）
// 移植自 src/tiles.js / src/gameLogic.js / src/ai.js / src/roomManager.js
// 通过 onEmit(event, data) 向外部（app.js 的伪 socket 代理）发送与真实服务器一致的事件，
// 从而复用现有整套 UI 渲染与操作逻辑。
(function (global) {
  'use strict';

  // ===================== 牌定义 =====================
  const TILE_TYPES = { WAN: 'wan', TIAO: 'tiao', TONG: 'tong', FENG: 'feng', JIAN: 'jian', HUA: 'hua' };

  function createAllTiles() {
    const tiles = [];
    let id = 0;
    const push = (type, num, name, short, extra) => {
      tiles.push(Object.assign({ id: id++, type, num, name, short }, extra || {}));
    };
    for (let n = 1; n <= 9; n++) for (let c = 0; c < 4; c++) push('wan', n, n + '万', n + 'W');
    for (let n = 1; n <= 9; n++) for (let c = 0; c < 4; c++) push('tiao', n, n + '条', n + 'T');
    for (let n = 1; n <= 9; n++) for (let c = 0; c < 4; c++) push('tong', n, n + '筒', n + 'P');
    const fengNames = ['东', '南', '西', '北'];
    for (let i = 0; i < 4; i++) for (let c = 0; c < 4; c++) push('feng', i + 1, fengNames[i] + '风', fengNames[i]);
    const jianNames = ['中', '发', '白'];
    for (let i = 0; i < 3; i++) for (let c = 0; c < 4; c++) push('jian', i + 1, jianNames[i], jianNames[i]);
    push('hua', 1, '财神', '花', { isHua: true });
    return tiles;
  }

  function getTileKey(t) { return t.type + '_' + t.num; }
  function getSortKey(t) {
    const o = { wan: 0, tiao: 1, tong: 2, feng: 3, jian: 4, hua: 5 };
    return o[t.type] * 100 + t.num;
  }
  function sortTiles(tiles) { return [...tiles].sort((a, b) => getSortKey(a) - getSortKey(b)); }
  function isSameTile(a, b) { return a.type === b.type && a.num === b.num; }
  function shuffleTiles(tiles) {
    const a = [...tiles];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function rollDice() { return [Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)]; }
  function makeTileFromKey(key) {
    const [type, numStr] = key.split('_');
    const num = parseInt(numStr);
    const names = { wan: num + '万', tiao: num + '条', tong: num + '筒', feng: ['东', '南', '西', '北'][num - 1], jian: ['中', '发', '白'][num - 1] };
    return { id: -1, type, num, name: names[type] || key, short: key };
  }

  // ===================== 胡牌/听牌/计分 =====================
  function buildCounts(tiles) {
    const c = {};
    for (const t of tiles) { const k = getTileKey(t); c[k] = (c[k] || 0) + 1; }
    return c;
  }
  function canFormSets(counts, needSets) {
    if (needSets === 0) {
      for (const k of Object.keys(counts)) if (counts[k] > 0) return false;
      return true;
    }
    let firstKey = null;
    const sorted = Object.keys(counts).sort();
    for (const k of sorted) { if (counts[k] > 0) { firstKey = k; break; } }
    if (!firstKey) return needSets === 0;
    const [type, numStr] = firstKey.split('_');
    const num = parseInt(numStr);
    if (counts[firstKey] >= 3) {
      counts[firstKey] -= 3;
      if (canFormSets(counts, needSets - 1)) { counts[firstKey] += 3; return true; }
      counts[firstKey] += 3;
    }
    if ((type === 'wan' || type === 'tiao' || type === 'tong') && num <= 7) {
      const k2 = type + '_' + (num + 1), k3 = type + '_' + (num + 2);
      if ((counts[k2] || 0) > 0 && (counts[k3] || 0) > 0) {
        counts[firstKey]--; counts[k2]--; counts[k3]--;
        if (canFormSets(counts, needSets - 1)) { counts[firstKey]++; counts[k2]++; counts[k3]++; return true; }
        counts[firstKey]++; counts[k2]++; counts[k3]++;
      }
    }
    return false;
  }
  function canFormPairAndSets(counts, needSets) {
    const keys = Object.keys(counts);
    for (const pk of keys) {
      if (counts[pk] >= 2) {
        counts[pk] -= 2;
        if (canFormSets(counts, needSets)) { counts[pk] += 2; return true; }
        counts[pk] += 2;
      }
    }
    return false;
  }
  function isSevenPairs(tiles) {
    if (tiles.length !== 14) return false;
    const c = buildCounts(tiles);
    for (const k of Object.keys(c)) if (c[k] % 2 !== 0) return false;
    return Object.keys(c).length === 7;
  }
  function canHu(handTiles, pengCount, gangCount) {
    const needSets = 4 - pengCount - gangCount;
    const expectedLen = needSets * 3 + 2;
    if (handTiles.length !== expectedLen) return false;
    if (needSets === 4 && isSevenPairs(handTiles)) return true;
    return canFormPairAndSets(buildCounts(handTiles), needSets);
  }
  function getAllPossibleTileKeys() {
    const keys = [];
    for (let n = 1; n <= 9; n++) keys.push('wan_' + n);
    for (let n = 1; n <= 9; n++) keys.push('tiao_' + n);
    for (let n = 1; n <= 9; n++) keys.push('tong_' + n);
    for (let n = 1; n <= 4; n++) keys.push('feng_' + n);
    for (let n = 1; n <= 3; n++) keys.push('jian_' + n);
    return keys;
  }
  function getTenpai(handTiles, pengCount, gangCount) {
    const result = [];
    const needSets = 4 - pengCount - gangCount;
    for (const key of getAllPossibleTileKeys()) {
      const fake = makeTileFromKey(key);
      const test = [...handTiles, fake];
      if (canHu(test, pengCount, gangCount)) {
        result.push({ key, type: getHuType(test, fake, pengCount, gangCount) });
      }
    }
    return result;
  }
  function getHuType(tiles, huTile, pengCount, gangCount) {
    const needSets = 4 - pengCount - gangCount;
    if (needSets === 4 && isSevenPairs(tiles)) return 'qixingdui';
    const huKey = getTileKey(huTile);
    const counts = buildCounts(tiles);
    const [type, numStr] = huKey.split('_');
    const num = parseInt(numStr);
    if (type === 'wan' || type === 'tiao' || type === 'tong') {
      if (num === 3 && (counts[type + '_1'] || 0) > 0 && (counts[type + '_2'] || 0) > 0) {
        counts[type + '_1']--; counts[type + '_2']--; counts[huKey]--;
        if (canFormPairAndSets(counts, needSets - 1)) { counts[type + '_1']++; counts[type + '_2']++; counts[huKey]++; return 'bian'; }
        counts[type + '_1']++; counts[type + '_2']++; counts[huKey]++;
      }
      if (num === 7 && (counts[type + '_8'] || 0) > 0 && (counts[type + '_9'] || 0) > 0) {
        counts[type + '_8']--; counts[type + '_9']--; counts[huKey]--;
        if (canFormPairAndSets(counts, needSets - 1)) { counts[type + '_8']++; counts[type + '_9']++; counts[huKey]++; return 'bian'; }
        counts[type + '_8']++; counts[type + '_9']++; counts[huKey]++;
      }
    }
    if ((type === 'wan' || type === 'tiao' || type === 'tong') && num >= 2 && num <= 8) {
      const k1 = type + '_' + (num - 1), k3 = type + '_' + (num + 1);
      if ((counts[k1] || 0) > 0 && (counts[k3] || 0) > 0) {
        counts[k1]--; counts[huKey]--; counts[k3]--;
        if (canFormPairAndSets(counts, needSets - 1)) { counts[k1]++; counts[huKey]++; counts[k3]++; return 'ka'; }
        counts[k1]++; counts[huKey]++; counts[k3]++;
      }
    }
    if (counts[huKey] >= 2) {
      counts[huKey] -= 2;
      if (canFormSets(counts, needSets)) { counts[huKey] += 2; return 'diao'; }
      counts[huKey] += 2;
    }
    return 'normal';
  }
  function canPeng(handTiles, tile) {
    const k = getTileKey(tile);
    return handTiles.filter(t => getTileKey(t) === k).length >= 2;
  }
  function canMingGang(handTiles, tile) {
    const k = getTileKey(tile);
    return handTiles.filter(t => getTileKey(t) === k).length >= 3;
  }
  function getAnGangOptions(handTiles) {
    const c = buildCounts(handTiles), res = [];
    for (const k of Object.keys(c)) if (c[k] >= 4) res.push(k);
    return res;
  }
  function getBuGangOptions(handTiles, pengArea) {
    const c = buildCounts(handTiles), res = [];
    for (const peng of pengArea) {
      const k = getTileKey(peng.tiles[0]);
      if (c[k] >= 1) res.push(k);
    }
    return res;
  }
  function calculateScore(params) {
    const { winner, dianPaoPlayer, isZhuang, isZimo, hasHua, huType, gangScores, zuizi, players } = params;
    const transactions = [];
    if (isZimo) {
      for (const p of players) {
        if (p.id === winner) continue;
        transactions.push({ from: p.id, to: winner, amount: (p.isZhuang ? 50 : 10) * 2, reason: '自摸' });
      }
    } else {
      transactions.push({ from: dianPaoPlayer, to: winner, amount: isZhuang ? 50 : 10, reason: '点炮' });
    }
    if (hasHua) {
      if (isZimo) for (const p of players) { if (p.id !== winner) transactions.push({ from: p.id, to: winner, amount: zuizi, reason: '财神' }); }
      else transactions.push({ from: dianPaoPlayer, to: winner, amount: zuizi, reason: '财神' });
    }
    if (huType === 'bian' || huType === 'ka' || huType === 'diao') {
      if (isZimo) for (const p of players) { if (p.id !== winner) transactions.push({ from: p.id, to: winner, amount: zuizi, reason: huType }); }
      else transactions.push({ from: dianPaoPlayer, to: winner, amount: zuizi, reason: huType });
    }
    if (gangScores) {
      for (const pid of Object.keys(gangScores)) {
        if (gangScores[pid] !== 0) {
          for (const p of players) { if (p.id !== pid) transactions.push({ from: p.id, to: pid, amount: Math.abs(gangScores[pid]), reason: '杠分' }); }
        }
      }
    }
    const net = {};
    for (const p of players) net[p.id] = 0;
    for (const t of transactions) { net[t.from] -= t.amount; net[t.to] += t.amount; }
    return { transactions, netScores: net };
  }

  // ===================== AI 决策（移植 ai.js，去掉 room 依赖） =====================
  function chooseDiscard(hand, isTenpai, lastDrawTile) {
    if (isTenpai && lastDrawTile) return lastDrawTile.id;
    const lonely = hand.filter(t => isLonelyTile(hand, t));
    if (lonely.length > 0) return lonely[Math.floor(Math.random() * lonely.length)].id;
    const typeGroups = {};
    for (const t of hand) { if (!typeGroups[t.type]) typeGroups[t.type] = []; typeGroups[t.type].push(t); }
    const sortedTypes = Object.keys(typeGroups).sort((a, b) => typeGroups[a].length - typeGroups[b].length);
    for (const type of sortedTypes) {
      const group = typeGroups[type];
      if (type === 'feng' || type === 'jian') continue;
      const nums = group.map(x => x.num);
      const edge = group.filter(t => !nums.includes(t.num - 1) || !nums.includes(t.num + 1));
      if (edge.length > 0) return edge[Math.floor(Math.random() * edge.length)].id;
    }
    return hand[Math.floor(Math.random() * hand.length)].id;
  }
  function isLonelyTile(hand, tile) {
    if (tile.type === 'feng' || tile.type === 'jian' || tile.type === 'hua') {
      return hand.filter(t => t.type === tile.type && t.num === tile.num).length === 1;
    }
    const nums = hand.filter(t => t.type === tile.type && t.id !== tile.id).map(t => t.num);
    return !nums.some(n => Math.abs(n - tile.num) <= 2);
  }

  // ===================== 单机游戏引擎 =====================
  class LocalGame {
    constructor(opts) {
      opts = opts || {};
      this.zuizi = opts.zuizi || 10;
      this.onEmit = opts.onEmit || function () {};
      this.delay = opts.delay != null ? opts.delay : 550;
      this.aiNames = ['电脑·东风', '电脑·南风', '电脑·西风', '电脑·红中', '电脑·发财', '电脑·白板'];
      this.players = [null, null, null, null];
      this.phase = 'waiting';
      this.wallTiles = [];
      this.discardTiles = [];
      this.currentPlayer = 0;
      this.dealer = 0;
      this.lastDiscard = null;
      this.lastDiscardPlayer = -1;
      this.gangScores = {};
      this.winner = null;
      this.winType = null;
      this.huDetail = null;
      this.roundNumber = 0;
      this.awaitingHuman = false;
      this.pendingResponders = null;
      this._myName = opts.myName || '你';
    }

    // ---- 生命周期 ----
    start() { this.roundNumber = 0; this.startNewGame(); }

    startNewGame() {
      this.roundNumber++;
      this.gameSeq = (this.gameSeq || 0) + 1;
      this.phase = 'playing';
      this.awaitingHuman = false;
      this.pendingResponders = null;
      this.wallTiles = []; this.discardTiles = []; this.lastDiscard = null; this.lastDiscardPlayer = -1;
      this.gangScores = {}; this.winner = null; this.winType = null; this.huDetail = null;
      for (let i = 0; i < 4; i++) {
        if (!this.players[i]) this.players[i] = this._makePlayer(i, i === 0 ? this._myName : this._randAiName());
        else {
          const p = this.players[i];
          p.handTiles = []; p.pengArea = []; p.gangArea = []; p.huaTiles = [];
          p.isTenpai = false; p.tenpaiInfo = null; p.hasHua = false; p.score = 0;
          p.lastDrawTile = null; p.isReady = true;
        }
      }
      if (this.roundNumber === 1 || this.dealer === -1) this._rollForDealer();
      this._dealTiles();
      this.onEmit('joinedRoom', { seat: 0, roomId: '单机', zuizi: this.zuizi, gameState: this._buildState() });
      this.onEmit('gameStart', { roundNumber: this.roundNumber, dealer: this.dealer });
      this._emitState();
      // 庄家已持 14 张，直接进入"必须出牌"状态，不再摸牌
      this._dealerFirstTurn();
    }

    // 庄家开局首轮：不摸牌，直接出牌
    _dealerFirstTurn() {
      if (this.phase !== 'playing') return;
      const seat = this.dealer;
      this.currentPlayer = seat;
      this.onEmit('yourTurn', { mustDiscard: true, drewTile: false });
      const self = this.getSelfActions(seat);
      if (seat === 0) {
        this.awaitingHuman = true;
        this.onEmit('selfActions', { actions: self });
        return;
      }
      if (self.length > 0) this._later(() => this._aiSelfPlay(seat, self));
      else this._later(() => this._aiDiscard(seat));
    }

    _makePlayer(seat, name) {
      return {
        id: 'p' + seat, name, seat, isAI: seat !== 0, isReady: true, handTiles: [], pengArea: [],
        gangArea: [], huaTiles: [], isTenpai: false, tenpaiInfo: null, hasHua: false, isDealer: false,
        score: 0, totalScore: 0, disconnected: false, lastDrawTile: null
      };
    }
    _randAiName() {
      let name = this.aiNames[Math.floor(Math.random() * this.aiNames.length)];
      const used = new Set(this.players.filter(p => p).map(p => p.name));
      let s = 1;
      while (used.has(name)) { name = this.aiNames[Math.floor(Math.random() * this.aiNames.length)] + s; s++; }
      return name;
    }
    _rollForDealer() {
      const res = [];
      for (let i = 0; i < 4; i++) { const d = rollDice(); res.push({ seat: i, dice: d[0] + d[1] }); }
      res.sort((a, b) => b.dice - a.dice);
      this.dealer = res[0].seat;
      for (let i = 0; i < 4; i++) if (this.players[i]) this.players[i].isDealer = (i === this.dealer);
      this.diceResults = res;
    }
    _dealTiles() {
      this.wallTiles = shuffleTiles(createAllTiles());
      for (let i = 0; i < 4; i++) {
        const p = this.players[i];
        const count = (i === this.dealer) ? 14 : 13;
        p.handTiles = sortTiles(this.wallTiles.splice(0, count));
      }
      this._checkHuaForAll();
      this.currentPlayer = this.dealer;
      // 庄家开局第 14 张视为"刚摸的牌"，用于自摸/顶张报听判定
      const d = this.players[this.dealer];
      if (d && !d.lastDrawTile) d.lastDrawTile = d.handTiles[d.handTiles.length - 1];
    }
    _checkHuaForAll() { for (const p of this.players) if (p) this._checkAndReplaceHua(p); }
    _checkAndReplaceHua(player) {
      let found = true;
      while (found) {
        found = false;
        for (let i = 0; i < player.handTiles.length; i++) {
          if (player.handTiles[i].isHua) {
            const hua = player.handTiles.splice(i, 1)[0];
            player.huaTiles.push(hua); player.hasHua = true;
            if (this.wallTiles.length > 0) {
              const nt = this.wallTiles.pop();
              player.handTiles.push(nt); player.handTiles = sortTiles(player.handTiles);
              player.lastDrawTile = nt;
              if (nt.isHua) { found = true; break; }
            }
            found = true; break;
          }
        }
      }
    }

    // ---- 核心动作 ----
    drawTile(seat) {
      if (this.wallTiles.length === 0) { this._handleDraw(); return null; }
      const p = this.players[seat];
      const tile = this.wallTiles.shift();
      p.handTiles.push(tile); p.handTiles = sortTiles(p.handTiles); p.lastDrawTile = tile;
      if (tile.isHua) {
        p.huaTiles.push(tile); p.handTiles.pop(); p.hasHua = true;
        if (this.wallTiles.length > 0) {
          const nt = this.wallTiles.pop();
          p.handTiles.push(nt); p.handTiles = sortTiles(p.handTiles); p.lastDrawTile = nt;
          if (nt.isHua) this._checkAndReplaceHua(p);
        }
      }
      return tile;
    }
    discardTile(seat, tileId) {
      const p = this.players[seat];
      const idx = p.handTiles.findIndex(t => t.id === tileId);
      if (idx === -1) return null;
      const tile = p.handTiles.splice(idx, 1)[0];
      p.lastDrawTile = null;
      this.lastDiscard = tile; this.lastDiscardPlayer = seat;
      this.discardTiles.push({ tile, player: seat });
      return tile;
    }
    peng(seat, fromSeat) {
      const p = this.players[seat];
      const tile = this.lastDiscard, key = getTileKey(tile);
      const matching = p.handTiles.filter(t => getTileKey(t) === key);
      if (matching.length < 2) return false;
      for (let i = 0; i < 2; i++) p.handTiles.splice(p.handTiles.findIndex(t => getTileKey(t) === key), 1);
      p.pengArea.push({ tiles: [tile, matching[0], matching[1]], fromTile: tile, fromPlayer: fromSeat });
      this.discardTiles.pop();
      return true;
    }
    mingGang(seat, fromSeat) {
      const p = this.players[seat];
      const tile = this.lastDiscard, key = getTileKey(tile);
      const matching = p.handTiles.filter(t => getTileKey(t) === key);
      if (matching.length < 3) return false;
      for (let i = 0; i < 3; i++) p.handTiles.splice(p.handTiles.findIndex(t => getTileKey(t) === key), 1);
      p.gangArea.push({ tiles: [tile, matching[0], matching[1], matching[2]], type: 'ming', fromPlayer: fromSeat });
      this.discardTiles.pop();
      this.gangScores[seat] = (this.gangScores[seat] || 0) + this.zuizi;
      this.gangScores[fromSeat] = (this.gangScores[fromSeat] || 0) - this.zuizi;
      this._drawAfterGang(seat);
      return true;
    }
    anGang(seat, tileKey) {
      const p = this.players[seat];
      const matching = p.handTiles.filter(t => getTileKey(t) === tileKey);
      if (matching.length < 4) return false;
      for (let i = 0; i < 4; i++) p.handTiles.splice(p.handTiles.findIndex(t => getTileKey(t) === tileKey), 1);
      p.gangArea.push({ tiles: matching, type: 'an', fromPlayer: -1 });
      this.gangScores[seat] = (this.gangScores[seat] || 0) + this.zuizi * 2 * 3;
      for (let i = 0; i < 4; i++) if (i !== seat && this.players[i]) this.gangScores[i] = (this.gangScores[i] || 0) - this.zuizi * 2;
      this._drawAfterGang(seat);
      return true;
    }
    buGang(seat, tileKey) {
      const p = this.players[seat];
      const pengIdx = p.pengArea.findIndex(pa => getTileKey(pa.tiles[0]) === tileKey);
      if (pengIdx === -1) return false;
      const handIdx = p.handTiles.findIndex(t => getTileKey(t) === tileKey);
      if (handIdx === -1) return false;
      const tile = p.handTiles.splice(handIdx, 1)[0];
      const peng = p.pengArea.splice(pengIdx, 1)[0];
      p.gangArea.push({ tiles: [...peng.tiles, tile], type: 'ming', fromPlayer: peng.fromPlayer });
      this.gangScores[seat] = (this.gangScores[seat] || 0) + this.zuizi;
      this.gangScores[peng.fromPlayer] = (this.gangScores[peng.fromPlayer] || 0) - this.zuizi;
      this._drawAfterGang(seat);
      return true;
    }
    _drawAfterGang(seat) {
      const p = this.players[seat];
      // 牌墙摸完时无法补杠牌 → 荒庄
      if (this.wallTiles.length === 0) { this._handleDraw(); return; }
      if (this.wallTiles.length > 0) {
        const tile = this.wallTiles.pop();
        p.handTiles.push(tile); p.handTiles = sortTiles(p.handTiles); p.lastDrawTile = tile;
        if (tile.isHua) {
          p.huaTiles.push(tile); p.handTiles.pop(); p.hasHua = true;
          if (this.wallTiles.length > 0) { const nt = this.wallTiles.pop(); p.handTiles.push(nt); p.handTiles = sortTiles(p.handTiles); p.lastDrawTile = nt; }
        }
      }
    }

    // ---- 判定 ----
    checkHu(seat, tile) {
      const p = this.players[seat];
      const test = [...p.handTiles];
      if (tile && !test.find(t => t.id === tile.id)) test.push(tile);
      const pengCount = p.pengArea.length, gangCount = p.gangArea.length;
      if (!canHu(test, pengCount, gangCount)) return null;
      const huTile = tile || p.lastDrawTile;
      return { canHu: true, type: getHuType(test, huTile, pengCount, gangCount), tiles: test, huTile };
    }
    checkZimo(seat) { const p = this.players[seat]; if (!p || !p.lastDrawTile) return null; return this.checkHu(seat, p.lastDrawTile); }
    checkDianHu(seat) {
      if (!this.lastDiscard || !this.players[seat] || !this.players[seat].isTenpai) return null;
      return this.checkHu(seat, this.lastDiscard);
    }
    getAvailableActions(seat) {
      const p = this.players[seat];
      if (!p) return [];
      const acts = [];
      if (this.lastDiscard && this.lastDiscardPlayer !== seat) {
        if (canPeng(p.handTiles, this.lastDiscard)) acts.push({ type: 'peng' });
        if (canMingGang(p.handTiles, this.lastDiscard)) acts.push({ type: 'minggang' });
        if (p.isTenpai) { const hu = this.checkHu(seat, this.lastDiscard); if (hu) acts.push({ type: 'hu' }); }
      }
      return acts;
    }
    getSelfActions(seat) {
      const p = this.players[seat];
      if (!p) return [];
      const acts = [];
      const zimo = this.checkZimo(seat);
      if (zimo) acts.push({ type: 'zimo', huType: zimo.type });
      for (const k of getAnGangOptions(p.handTiles)) acts.push({ type: 'angang', tileKey: k });
      for (const k of getBuGangOptions(p.handTiles, p.pengArea)) acts.push({ type: 'bugang', tileKey: k });
      if (!p.isTenpai) {
        const t = this._checkTenpaiWithDingZhang(seat);
        if (t.canReport) acts.push({ type: 'ting', info: t });
      }
      return acts;
    }
    _checkTenpaiWithDingZhang(seat) {
      const p = this.players[seat];
      if (!p || !p.lastDrawTile) return { canReport: false };
      const reportable = [];
      for (let i = 0; i < p.handTiles.length; i++) {
        const test = [...p.handTiles]; test.splice(i, 1);
        const tenpai = getTenpai(test, p.pengArea.length, p.gangArea.length);
        if (tenpai.length > 0) reportable.push({ discardTileId: p.handTiles[i].id, discardTileKey: getTileKey(p.handTiles[i]), tenpaiTiles: tenpai });
      }
      if (reportable.length > 0) return { canReport: true, dingZhang: p.lastDrawTile, options: reportable };
      return { canReport: false };
    }
    reportTenpai(seat, discardTileId) {
      const p = this.players[seat];
      const check = this._checkTenpaiWithDingZhang(seat);
      if (!check.canReport) return false;
      const opt = check.options.find(o => o.discardTileId === discardTileId);
      if (!opt) return false;
      p.isTenpai = true;
      p.tenpaiInfo = { dingZhang: p.lastDrawTile, discardTileId, tenpaiTiles: opt.tenpaiTiles };
      return true;
    }
    handleHu(winnerSeat, dianPaoSeat, isZimo) {
      if (this.phase !== 'playing') return null; // 防止重复结算
      const winner = this.players[winnerSeat];
      const hu = isZimo ? this.checkZimo(winnerSeat) : this.checkHu(winnerSeat, this.lastDiscard);
      if (!hu) return null;
      const isZhuang = winnerSeat === this.dealer;
      const hasHua = winner.hasHua;
      const huType = hu.type;
      const players = this.players.map(p => ({ id: p.seat, isZhuang: p.seat === this.dealer }));
      const scoreResult = calculateScore({ winner: winnerSeat, dianPaoPlayer: dianPaoSeat, isZhuang, isZimo, hasHua, huType, gangScores: this.gangScores, zuizi: this.zuizi, players });
      for (const pid of Object.keys(scoreResult.netScores)) {
        const s = parseInt(pid);
        if (this.players[s]) { this.players[s].score = scoreResult.netScores[pid]; this.players[s].totalScore += scoreResult.netScores[pid]; }
      }
      this.winner = winnerSeat;
      this.winType = isZimo ? 'zimo' : 'dianpao';
      this.huDetail = { huType, hasHua, isZhuang, dianPaoSeat, transactions: scoreResult.transactions };
      this.phase = 'finished';
      this.awaitingHuman = false;
      if (winnerSeat !== this.dealer) {
        this.dealer = (this.dealer + 1) % 4;
        while (!this.players[this.dealer]) this.dealer = (this.dealer + 1) % 4;
      }
      const playersOut = this.players.map((pl, i) => ({
        seat: i, name: pl ? pl.name : '', isAI: pl ? pl.isAI : false,
        isDealer: i === this.dealer, totalScore: pl ? pl.totalScore : 0
      }));
      this.onEmit('gameOver', {
        winType: this.winType, winner: winnerSeat, dianPaoPlayer: dianPaoSeat,
        players: playersOut, netScores: scoreResult.netScores, huDetail: this.huDetail
      });
      return scoreResult;
    }
    _handleDraw() {
      if (this.phase !== 'playing') return; // 防止重复结算
      this.phase = 'finished';
      this.winType = 'draw';
      this.winner = -1;
      this.awaitingHuman = false;
      const playersOut = this.players.map((pl, i) => ({ seat: i, name: pl ? pl.name : '', isAI: pl ? pl.isAI : false, isDealer: i === this.dealer, totalScore: pl ? pl.totalScore : 0 }));
      this.onEmit('gameOver', { winType: 'draw', winner: -1, dianPaoPlayer: null, players: playersOut, netScores: {}, huDetail: null });
    }
    nextPlayer() {
      this.currentPlayer = (this.currentPlayer + 1) % 4;
      while (!this.players[this.currentPlayer]) this.currentPlayer = (this.currentPlayer + 1) % 4;
    }

    // ---- 状态构造 ----
    _buildState() {
      const p0 = this.players[0];
      return {
        phase: this.phase,
        currentPlayer: this.currentPlayer,
        dealer: this.dealer,
        remainingTiles: this.wallTiles.length,
        discardTiles: this.discardTiles,
        lastDiscard: this.lastDiscard,
        lastDiscardPlayer: this.lastDiscardPlayer,
        myHand: p0.handTiles,
        myPengArea: p0.pengArea,
        myGangArea: p0.gangArea,
        myHuaTiles: p0.huaTiles,
        isTenpai: p0.isTenpai,
        tenpaiInfo: p0.tenpaiInfo,
        hasHua: p0.hasHua,
        lastDrawTile: p0.lastDrawTile,
        roundNumber: this.roundNumber,
        zuizi: this.zuizi,
        players: this.players.map((pl, i) => ({
          seat: i, name: pl ? pl.name : '', isAI: pl ? pl.isAI : false,
          tileCount: pl ? pl.handTiles.length : 0,
          pengCount: pl ? pl.pengArea.length : 0,
          gangCount: pl ? pl.gangArea.length : 0,
          huaCount: pl ? pl.huaTiles.length : 0,
          isDealer: i === this.dealer, isTenpai: pl ? pl.isTenpai : false,
          score: pl ? pl.score : 0, totalScore: pl ? pl.totalScore : 0,
          pengArea: pl ? pl.pengArea : [], gangArea: pl ? pl.gangArea : [], disconnected: pl ? pl.disconnected : false
        }))
      };
    }
    _emitState() { this.onEmit('gameState', this._buildState()); }

    // ---- 回合推进 ----
    // 延时调度：带局次与阶段守卫，避免上一局遗留的定时器打乱新一局状态
    _later(fn) {
      const seq = this.gameSeq;
      const run = () => {
        if (this.gameSeq !== seq || this.phase !== 'playing') return;
        fn();
      };
      // delay=0 时走 setImmediate（Node 压测提速），浏览器仍用 setTimeout
      if (this.delay <= 0 && typeof setImmediate === 'function') setImmediate(run);
      else setTimeout(run, this.delay);
    }
    _myTurn(seat) {
      if (this.phase !== 'playing') return;
      this.currentPlayer = seat;
      const tile = this.drawTile(seat);
      // drawTile 内部已处理荒庄，这里直接返回，避免重复结算
      if (!tile) return;
      this._emitState();
      this.onEmit('yourTurn', { mustDiscard: true, drewTile: true });
      const self = this.getSelfActions(seat);
      if (seat === 0) this.awaitingHuman = true;
      this.onEmit('selfActions', { actions: self });
      if (seat === 0) return;
      if (self.length > 0) this._later(() => this._aiSelfPlay(seat, self));
      else this._later(() => this._aiDiscard(seat));
    }
    _afterPeng(seat) {
      if (this.phase !== 'playing') return;
      this.currentPlayer = seat;
      this._emitState();
      this.onEmit('yourTurn', { mustDiscard: true, drewTile: false });
      if (seat === 0) {
        this.awaitingHuman = true;
        this.onEmit('selfActions', { actions: this.getSelfActions(seat) });
        return;
      }
      this._later(() => this._aiDiscard(seat));
    }
    _afterGang(seat) {
      if (this.phase !== 'playing') return;
      this.currentPlayer = seat;
      this._emitState();
      this.onEmit('yourTurn', { mustDiscard: true, drewTile: true });
      const self = this.getSelfActions(seat);
      if (seat === 0) this.awaitingHuman = true;
      this.onEmit('selfActions', { actions: self });
      if (seat === 0) return;
      if (self.length > 0) this._later(() => this._aiSelfPlay(seat, self));
      else this._later(() => this._aiDiscard(seat));
    }
    _afterDiscard(seat, tile) {
      if (this.phase !== 'playing') return;
      this.onEmit('tileDiscarded', { player: seat, tile });
      this._emitState();
      const responders = new Map();
      for (let s = 0; s < 4; s++) {
        if (s === seat) continue;
        const acts = this.getAvailableActions(s);
        if (acts.length > 0) responders.set(s, acts.map(a => a.type));
      }
      if (responders.size === 0) { this._advanceFrom(seat); return; }
      if (responders.has(0)) {
        this.pendingResponders = responders;
        this.awaitingHuman = true;
        this.onEmit('availableActions', { actions: responders.get(0).map(t => ({ type: t })) });
        return;
      }
      this._resolveResponders(Array.from(responders.entries()), seat, tile, () => this._advanceFrom(seat));
    }
    _resolveResponders(entries, discardSeat, tile, onDone) {
      if (this.phase !== 'playing') return;
      if (entries.length === 0) { onDone(); return; }
      let chosen = null;
      for (const typ of ['hu', 'minggang', 'peng']) {
        for (const [s, acts] of entries) { if (acts.includes(typ)) { chosen = { seat: s, type: typ }; break; } }
        if (chosen) break;
      }
      if (!chosen) { onDone(); return; }
      const s = chosen.seat;
      if (chosen.type === 'hu') { this.handleHu(s, discardSeat, false); return; }
      if (chosen.type === 'minggang') {
        this.mingGang(s, discardSeat);
        this.onEmit('gangOccurred', { player: s, type: 'ming' });
        this._emitState(); this._afterGang(s); return;
      }
      this.peng(s, discardSeat);
      this.onEmit('pengOccurred', { player: s });
      this._emitState(); this._afterPeng(s);
    }
    _advanceFrom(discardSeat) {
      if (this.phase !== 'playing') return;
      this.currentPlayer = discardSeat;
      this.nextPlayer();
      this._myTurn(this.currentPlayer);
    }

    // ---- AI ----
    _aiSelfPlay(seat, selfActions) {
      const zimo = selfActions.find(a => a.type === 'zimo');
      if (zimo) { this.handleHu(seat, null, true); return; }
      const ting = selfActions.find(a => a.type === 'ting');
      if (ting && ting.info && ting.info.options.length > 0) {
        const best = ting.info.options.reduce((b, o) => o.tenpaiTiles.length > b.tenpaiTiles.length ? o : b, ting.info.options[0]);
        if (this.reportTenpai(seat, best.discardTileId)) {
          // 报听后打出被顶替的那张牌（与服务端一致）
          const tile = this.discardTile(seat, best.discardTileId);
          this.onEmit('tenpaiReported', { player: seat, tile: tile || null });
          if (tile) { this._afterDiscard(seat, tile); return; }
        }
        this._aiDiscard(seat);
        return;
      }
      const gang = selfActions.find(a => a.type === 'angang' || a.type === 'bugang');
      if (gang) {
        if (gang.type === 'angang') this.anGang(seat, gang.tileKey);
        else this.buGang(seat, gang.tileKey);
        this.onEmit('gangOccurred', { player: seat, type: gang.type === 'an' ? 'an' : gang.type });
        this._emitState(); this._afterGang(seat);
        return;
      }
      this._aiDiscard(seat);
    }
    _aiDiscard(seat) {
      const p = this.players[seat];
      const id = chooseDiscard(p.handTiles, p.isTenpai, p.lastDrawTile);
      const tile = this.discardTile(seat, id);
      if (tile) this._afterDiscard(seat, tile);
    }

    // ---- 真人操作入口（由 app.js 通过伪 socket 调用） ----
    handleEmit(event, data) {
      data = data || {};
      if (event === 'discard') {
        if (!this.awaitingHuman || this.currentPlayer !== 0) return;
        const p = this.players[0];
        if (p.isTenpai && p.lastDrawTile && data.tileId !== p.lastDrawTile.id) {
          this.onEmit('error', { message: '听牌后只能打出刚摸的牌' }); return;
        }
        const tile = this.discardTile(0, data.tileId);
        if (!tile) return;
        this.awaitingHuman = false;
        this._afterDiscard(0, tile);
      } else if (event === 'zimo') {
        if (!this.awaitingHuman || this.currentPlayer !== 0) return;
        if (this.checkZimo(0)) { this.awaitingHuman = false; this.handleHu(0, null, true); }
      } else if (event === 'ting') {
        if (!this.awaitingHuman || this.currentPlayer !== 0) return;
        if (this.reportTenpai(0, data.discardTileId)) {
          this.awaitingHuman = false;
          const tile = this.discardTile(0, data.discardTileId);
          this.onEmit('tenpaiReported', { player: 0, tile: tile || null });
          if (tile) this._afterDiscard(0, tile);
        }
      } else if (event === 'angang') {
        if (!this.awaitingHuman || this.currentPlayer !== 0) return;
        if (this.anGang(0, data.tileKey)) { this.awaitingHuman = false; this.onEmit('gangOccurred', { player: 0, type: 'an' }); this._emitState(); this._afterGang(0); }
      } else if (event === 'bugang') {
        if (!this.awaitingHuman || this.currentPlayer !== 0) return;
        if (this.buGang(0, data.tileKey)) { this.awaitingHuman = false; this.onEmit('gangOccurred', { player: 0, type: 'ming' }); this._emitState(); this._afterGang(0); }
      } else if (event === 'peng') {
        if (!this.awaitingHuman || !this.pendingResponders || !this.pendingResponders.has(0)) return;
        this.peng(0, this.lastDiscardPlayer);
        this.pendingResponders.delete(0);
        this.awaitingHuman = false;
        this.onEmit('pengOccurred', { player: 0 });
        this._emitState(); this._afterPeng(0);
      } else if (event === 'minggang') {
        if (!this.awaitingHuman || !this.pendingResponders || !this.pendingResponders.has(0)) return;
        this.mingGang(0, this.lastDiscardPlayer);
        this.pendingResponders.delete(0);
        this.awaitingHuman = false;
        this.onEmit('gangOccurred', { player: 0, type: 'ming' });
        this._emitState(); this._afterGang(0);
      } else if (event === 'hu') {
        if (!this.awaitingHuman || !this.pendingResponders || !this.pendingResponders.has(0)) return;
        if (this.pendingResponders.get(0).includes('hu')) {
          this.awaitingHuman = false;
          this.handleHu(0, this.lastDiscardPlayer, false);
        }
      } else if (event === 'pass') {
        if (!this.awaitingHuman || !this.pendingResponders || !this.pendingResponders.has(0)) return;
        this.pendingResponders.delete(0);
        this.awaitingHuman = false;
        const remaining = Array.from(this.pendingResponders.entries());
        this._resolveResponders(remaining, this.lastDiscardPlayer, this.lastDiscard, () => this._advanceFrom(this.lastDiscardPlayer));
      } else if (event === 'newRound') {
        // 必须异步开局：gameOver 可能是在 peng/gang 的调用栈里同步抛出的，
        // 若此处立即重开，旧一局尚未返回的代码会继续操作新一局状态，造成串台
        if (this.phase === 'finished' && !this._restarting) {
          this._restarting = true;
          const kick = () => { this._restarting = false; this.startNewGame(); };
          if (this.delay <= 0 && typeof setImmediate === 'function') setImmediate(kick);
          else setTimeout(kick, 0);
        }
      }
      // 其余事件（getRooms/chat 等）在单机模式忽略
    }
  }

  // ===================== 导出 =====================
  global.LocalGame = LocalGame;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LocalGame, createAllTiles, canHu, isSevenPairs, getTenpai, getHuType, canPeng, canMingGang, getAnGangOptions, getBuGangOptions };
  }
})(typeof window !== 'undefined' ? window : globalThis);
