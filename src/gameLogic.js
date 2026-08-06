// 安阳麻将核心游戏逻辑
const { createAllTiles, getTileKey, isSameTile, sortTiles, shuffleTiles, TILE_TYPES } = require('./tiles');

// ============ 牌计数工具 ============

function buildCounts(tiles) {
  const counts = {};
  for (const t of tiles) {
    const key = getTileKey(t);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// ============ 胡牌判断 ============

// 检查能否分解成 needSets 个面子（不含对子）
function canFormSets(counts, needSets) {
  if (needSets === 0) {
    for (const k of Object.keys(counts)) {
      if (counts[k] > 0) return false;
    }
    return true;
  }

  // 找到最小还有牌的key
  let firstKey = null;
  const sortedKeys = Object.keys(counts).sort();
  for (const k of sortedKeys) {
    if (counts[k] > 0) { firstKey = k; break; }
  }
  if (!firstKey) return needSets === 0;

  const parts = firstKey.split('_');
  const type = parts[0];
  const num = parseInt(parts[1]);

  // 尝试刻子
  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (canFormSets(counts, needSets - 1)) {
      counts[firstKey] += 3;
      return true;
    }
    counts[firstKey] += 3;
  }

  // 尝试顺子（只有万/条/筒可以）
  if ((type === 'wan' || type === 'tiao' || type === 'tong') && num <= 7) {
    const k2 = type + '_' + (num + 1);
    const k3 = type + '_' + (num + 2);
    if ((counts[k2] || 0) > 0 && (counts[k3] || 0) > 0) {
      counts[firstKey]--; counts[k2]--; counts[k3]--;
      if (canFormSets(counts, needSets - 1)) {
        counts[firstKey]++; counts[k2]++; counts[k3]++;
        return true;
      }
      counts[firstKey]++; counts[k2]++; counts[k3]++;
    }
  }

  return false;
}

// 检查能否分解成 1对子 + needSets 个面子
function canFormPairAndSets(counts, needSets) {
  const keys = Object.keys(counts);
  for (const pairKey of keys) {
    if (counts[pairKey] >= 2) {
      counts[pairKey] -= 2;
      if (canFormSets(counts, needSets)) {
        counts[pairKey] += 2;
        return true;
      }
      counts[pairKey] += 2;
    }
  }
  return false;
}

// 检查是否七对
function isSevenPairs(tiles) {
  if (tiles.length !== 14) return false;
  const counts = buildCounts(tiles);
  for (const k of Object.keys(counts)) {
    if (counts[k] % 2 !== 0) return false;
  }
  return Object.keys(counts).length === 7;
}

// 主胡牌判断
// handTiles: 手牌数组, pengCount: 碰数, gangCount: 杠数
function canHu(handTiles, pengCount, gangCount) {
  const needSets = 4 - pengCount - gangCount;
  const expectedLen = needSets * 3 + 2;
  if (handTiles.length !== expectedLen) return false;

  // 七对（仅0碰0杠）
  if (needSets === 4 && isSevenPairs(handTiles)) return true;

  // 标准胡牌
  const counts = buildCounts(handTiles);
  return canFormPairAndSets(counts, needSets);
}

// ============ 听牌判断 ============

// 获取所有可能的牌类型（用于听牌遍历）
function getAllPossibleTileKeys() {
  const keys = [];
  for (let n = 1; n <= 9; n++) keys.push('wan_' + n);
  for (let n = 1; n <= 9; n++) keys.push('tiao_' + n);
  for (let n = 1; n <= 9; n++) keys.push('tong_' + n);
  for (let n = 1; n <= 4; n++) keys.push('feng_' + n);
  for (let n = 1; n <= 3; n++) keys.push('jian_' + n);
  return keys;
}

// 获取听牌列表
// 返回 [{ key, type }] type: 'bian'|'ka'|'diao'|'normal'
function getTenpai(handTiles, pengCount, gangCount) {
  const result = [];
  const needSets = 4 - pengCount - gangCount;
  const allKeys = getAllPossibleTileKeys();

  for (const key of allKeys) {
    // 构造一张临时牌
    const fakeTile = makeTileFromKey(key);
    const testTiles = [...handTiles, fakeTile];
    if (canHu(testTiles, pengCount, gangCount)) {
      const huType = getHuType(testTiles, fakeTile, pengCount, gangCount);
      result.push({ key, type: huType });
    }
  }
  return result;
}

function makeTileFromKey(key) {
  const [type, numStr] = key.split('_');
  const num = parseInt(numStr);
  const names = {
    wan: num + '万', tiao: num + '条', tong: num + '筒',
    feng: ['东', '南', '西', '北'][num - 1],
    jian: ['中', '发', '白'][num - 1]
  };
  return { id: -1, type, num, name: names[type] || key, short: key };
}

// ============ 边卡吊判断 ============

// 判断胡牌类型：边/卡/吊/普通
// tiles: 包含胡牌的手牌, huTile: 胡的那张牌
function getHuType(tiles, huTile, pengCount, gangCount) {
  const needSets = 4 - pengCount - gangCount;

  // 七对不算边卡吊
  if (needSets === 4 && isSevenPairs(tiles)) return 'qixingdui';

  const huKey = getTileKey(huTile);
  const counts = buildCounts(tiles);
  const [type, numStr] = huKey.split('_');
  const num = parseInt(numStr);

  // 1. 检查边（顺子边张）
  if (type === 'wan' || type === 'tiao' || type === 'tong') {
    // 边: 1-2听3 (胡牌是3，顺子1-2-3) 或 8-9听7 (胡牌是7，顺子7-8-9)
    if (num === 3 && (counts[type + '_1'] || 0) > 0 && (counts[type + '_2'] || 0) > 0) {
      counts[type + '_1']--; counts[type + '_2']--; counts[huKey]--;
      if (canFormPairAndSets(counts, needSets - 1)) {
        counts[type + '_1']++; counts[type + '_2']++; counts[huKey]++;
        return 'bian';
      }
      counts[type + '_1']++; counts[type + '_2']++; counts[huKey]++;
    }
    if (num === 7 && (counts[type + '_8'] || 0) > 0 && (counts[type + '_9'] || 0) > 0) {
      counts[type + '_8']--; counts[type + '_9']--; counts[huKey]--;
      if (canFormPairAndSets(counts, needSets - 1)) {
        counts[type + '_8']++; counts[type + '_9']++; counts[huKey]++;
        return 'bian';
      }
      counts[type + '_8']++; counts[type + '_9']++; counts[huKey]++;
    }
  }

  // 2. 检查卡（顺子中间张）
  if ((type === 'wan' || type === 'tiao' || type === 'tong') && num >= 2 && num <= 8) {
    const k1 = type + '_' + (num - 1);
    const k3 = type + '_' + (num + 1);
    if ((counts[k1] || 0) > 0 && (counts[k3] || 0) > 0) {
      counts[k1]--; counts[huKey]--; counts[k3]--;
      if (canFormPairAndSets(counts, needSets - 1)) {
        counts[k1]++; counts[huKey]++; counts[k3]++;
        return 'ka';
      }
      counts[k1]++; counts[huKey]++; counts[k3]++;
    }
  }

  // 3. 检查吊（将牌对子）
  if (counts[huKey] >= 2) {
    counts[huKey] -= 2;
    if (canFormSets(counts, needSets)) {
      counts[huKey] += 2;
      return 'diao';
    }
    counts[huKey] += 2;
  }

  return 'normal';
}

// ============ 碰杠判断 ============

// 检查能否碰某张牌
function canPeng(handTiles, tile) {
  const key = getTileKey(tile);
  let count = 0;
  for (const t of handTiles) {
    if (getTileKey(t) === key) count++;
  }
  return count >= 2;
}

// 检查能否明杠某张牌（别人出的牌）
function canMingGang(handTiles, tile) {
  const key = getTileKey(tile);
  let count = 0;
  for (const t of handTiles) {
    if (getTileKey(t) === key) count++;
  }
  return count >= 3;
}

// 检查能否暗杠（自己手中有4张相同的）
function getAnGangOptions(handTiles) {
  const counts = buildCounts(handTiles);
  const result = [];
  for (const key of Object.keys(counts)) {
    if (counts[key] >= 4) {
      result.push(key);
    }
  }
  return result;
}

// 检查能否补杠（碰过的牌又摸到第4张）
function getBuGangOptions(handTiles, pengArea) {
  const result = [];
  const handCounts = buildCounts(handTiles);
  for (const peng of pengArea) {
    const key = getTileKey(peng.tiles[0]);
    if (handCounts[key] >= 1) {
      result.push(key);
    }
  }
  return result;
}

// ============ 计分系统 ============

// 嘴子基础分
// 庄家基础分50, 闲家基础分10
// 自摸×2
// 花牌(财神)加嘴子
// 边卡吊加嘴子
// 杠分: 明杠10, 暗杠20

function calculateScore(params) {
  const {
    winner,         // 胡牌玩家
    dianPaoPlayer,  // 点炮玩家(null=自摸)
    isZhuang,       // 胡牌玩家是否庄家
    isZimo,         // 是否自摸
    hasHua,         // 是否有花牌(财神)
    huType,         // 胡牌类型: 'bian'|'ka'|'diao'|'normal'|'qixingdui'
    gangScores,     // 杠分信息 {playerId: score}
    zuizi,          // 嘴子金额
    players         // 所有玩家信息 [{id, isZhuang}]
  } = params;

  const baseScore = isZhuang ? 50 : 10; // 基础分
  const zuiziValue = zuizi; // 一个嘴子的金额

  const transactions = []; // 交易记录

  if (isZimo) {
    // 自摸：每人给胡牌玩家 基础分×2
    const perPlayer = baseScore * 2;
    for (const p of players) {
      if (p.id === winner) continue;
      const payerBase = p.isZhuang ? 50 : 10;
      const amount = payerBase * 2;
      transactions.push({ from: p.id, to: winner, amount, reason: '自摸' });
    }
  } else {
    // 点炮：点炮者给胡牌玩家基础分
    const amount = baseScore;
    transactions.push({ from: dianPaoPlayer, to: winner, amount, reason: '点炮' });
  }

  // 花牌加嘴子
  if (hasHua) {
    if (isZimo) {
      // 自摸：每人加一个嘴子
      for (const p of players) {
        if (p.id === winner) continue;
        transactions.push({ from: p.id, to: winner, amount: zuiziValue, reason: '财神' });
      }
    } else {
      // 点炮：点炮者加一个嘴子
      transactions.push({ from: dianPaoPlayer, to: winner, amount: zuiziValue, reason: '财神' });
    }
  }

  // 边卡吊加嘴子
  if (huType === 'bian' || huType === 'ka' || huType === 'diao') {
    if (isZimo) {
      for (const p of players) {
        if (p.id === winner) continue;
        transactions.push({ from: p.id, to: winner, amount: zuiziValue, reason: huType });
      }
    } else {
      transactions.push({ from: dianPaoPlayer, to: winner, amount: zuiziValue, reason: huType });
    }
  }

  // 杠分（荒庄不结算杠分，但这里单独处理）
  if (gangScores) {
    for (const pid of Object.keys(gangScores)) {
      if (gangScores[pid] !== 0) {
        // 杠分已经在外部计算好，这里直接加
        if (gangScores[pid] > 0) {
          // 该玩家赢得杠分
          for (const p of players) {
            if (p.id === pid) continue;
            transactions.push({ from: p.id, to: pid, amount: Math.abs(gangScores[pid]), reason: '杠分' });
          }
        }
      }
    }
  }

  // 汇总每人净输赢
  const netScores = {};
  for (const p of players) {
    netScores[p.id] = 0;
  }
  for (const t of transactions) {
    netScores[t.from] -= t.amount;
    netScores[t.to] += t.amount;
  }

  return { transactions, netScores };
}

// 计算杠分
// 明杠：被杠的玩家给杠者10分(1嘴子)
// 暗杠：每人给杠者20分(2嘴子)
function calculateGangScore(gangType, zuizi, targetPlayer) {
  if (gangType === 'ming') {
    return { amount: zuizi, from: targetPlayer }; // 被杠者付
  } else if (gangType === 'an') {
    return { amount: zuizi * 2, from: 'all' }; // 每人付
  }
  return null;
}

module.exports = {
  buildCounts,
  canHu,
  canFormSets,
  canFormPairAndSets,
  isSevenPairs,
  getTenpai,
  getHuType,
  canPeng,
  canMingGang,
  getAnGangOptions,
  getBuGangOptions,
  calculateScore,
  calculateGangScore,
  getAllPossibleTileKeys,
  makeTileFromKey
};
