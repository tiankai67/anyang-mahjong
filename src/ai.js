// 安阳麻将 AI 决策模块
const { getTileKey } = require('./tiles');

// AI 摸牌后决策
function decideAIPlay(room, seat) {
  const p = room.players[seat];
  if (!p || !p.isAI) return null;

  const selfActions = room.getSelfActions(seat);

  // 1. 能自摸则胡
  if (selfActions.some(a => a.type === 'zimo')) {
    return { type: 'zimo' };
  }

  // 2. 能报听则报听（选择听的牌张数最多的方案）
  const ting = selfActions.find(a => a.type === 'ting');
  if (ting && ting.info.options.length > 0) {
    const best = ting.info.options.reduce((best, opt) =>
      opt.tenpaiTiles.length > best.tenpaiTiles.length ? opt : best
    , ting.info.options[0]);
    return { type: 'ting', discardTileId: best.discardTileId };
  }

  // 3. 能杠则杠（暗杠/补杠）
  const gang = selfActions.find(a => a.type === 'angang' || a.type === 'bugang');
  if (gang) {
    return { type: gang.type, tileKey: gang.tileKey };
  }

  // 4. 出牌
  const discardId = chooseDiscard(p.handTiles, p.isTenpai, p.lastDrawTile);
  return { type: 'discard', tileId: discardId };
}

// AI 对他人出牌的响应
function decideAIReact(room, seat) {
  const p = room.players[seat];
  if (!p || !p.isAI) return null;

  const actions = room.getAvailableActions(seat);
  if (actions.length === 0) return { type: 'pass' };

  // 1. 能胡则胡
  if (actions.some(a => a.type === 'hu')) {
    return { type: 'hu' };
  }

  // 2. 能明杠则杠
  if (actions.some(a => a.type === 'minggang')) {
    return { type: 'minggang' };
  }

  // 3. 能碰则碰（AI 简化策略：有碰就碰）
  if (actions.some(a => a.type === 'peng')) {
    return { type: 'peng' };
  }

  return { type: 'pass' };
}

// 选择打出的牌
function chooseDiscard(hand, isTenpai, lastDrawTile) {
  if (isTenpai && lastDrawTile) {
    // 报听后只能打出刚摸的顶张
    return lastDrawTile.id;
  }

  // 优先打孤张/单张风箭
  const lonely = hand.filter(t => isLonelyTile(hand, t));
  if (lonely.length > 0) {
    return lonely[Math.floor(Math.random() * lonely.length)].id;
  }

  // 其次打数量最少的花色中靠边的牌
  const typeGroups = {};
  for (const t of hand) {
    if (!typeGroups[t.type]) typeGroups[t.type] = [];
    typeGroups[t.type].push(t);
  }
  const sortedTypes = Object.keys(typeGroups).sort((a, b) => typeGroups[a].length - typeGroups[b].length);
  for (const type of sortedTypes) {
    const group = typeGroups[type];
    if (type === 'feng' || type === 'jian') continue;
    const edgeTiles = group.filter(t => {
      const nums = group.map(x => x.num);
      return !nums.includes(t.num - 1) || !nums.includes(t.num + 1);
    });
    if (edgeTiles.length > 0) return edgeTiles[Math.floor(Math.random() * edgeTiles.length)].id;
  }

  // 兜底随机
  return hand[Math.floor(Math.random() * hand.length)].id;
}

// 判断是否为孤张（没有相邻牌）
function isLonelyTile(hand, tile) {
  if (tile.type === 'feng' || tile.type === 'jian' || tile.type === 'hua') {
    return hand.filter(t => t.type === tile.type && t.num === tile.num).length === 1;
  }
  const sameType = hand.filter(t => t.type === tile.type && t.id !== tile.id);
  const nums = sameType.map(t => t.num);
  return !nums.some(n => Math.abs(n - tile.num) <= 2);
}

module.exports = { decideAIPlay, decideAIReact };
