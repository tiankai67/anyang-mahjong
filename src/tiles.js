// 安阳麻将牌定义
// 136张标准牌 + 1张花牌(财神) = 137张

// 牌类型
const TILE_TYPES = {
  WAN: 'wan',     // 万
  TIAO: 'tiao',   // 条
  TONG: 'tong',   // 筒
  FENG: 'feng',   // 风
  JIAN: 'jian',   // 箭
  HUA: 'hua'      // 花(财神)
};

// 生成所有牌
function createAllTiles() {
  const tiles = [];
  let id = 0;

  // 万子 1-9 各4张
  for (let n = 1; n <= 9; n++) {
    for (let c = 0; c < 4; c++) {
      tiles.push({
        id: id++,
        type: TILE_TYPES.WAN,
        num: n,
        name: n + '万',
        short: n + 'W'
      });
    }
  }

  // 条子 1-9 各4张
  for (let n = 1; n <= 9; n++) {
    for (let c = 0; c < 4; c++) {
      tiles.push({
        id: id++,
        type: TILE_TYPES.TIAO,
        num: n,
        name: n + '条',
        short: n + 'T'
      });
    }
  }

  // 筒子 1-9 各4张
  for (let n = 1; n <= 9; n++) {
    for (let c = 0; c < 4; c++) {
      tiles.push({
        id: id++,
        type: TILE_TYPES.TONG,
        num: n,
        name: n + '筒',
        short: n + 'P'
      });
    }
  }

  // 风牌 东南西北 各4张
  const fengNames = ['东', '南', '西', '北'];
  const fengShorts = ['E', 'S', 'W', 'N'];
  for (let i = 0; i < 4; i++) {
    for (let c = 0; c < 4; c++) {
      tiles.push({
        id: id++,
        type: TILE_TYPES.FENG,
        num: i + 1,
        name: fengNames[i] + '风',
        short: fengNames[i]
      });
    }
  }

  // 箭牌 中发白 各4张
  const jianNames = ['中', '发', '白'];
  for (let i = 0; i < 3; i++) {
    for (let c = 0; c < 4; c++) {
      tiles.push({
        id: id++,
        type: TILE_TYPES.JIAN,
        num: i + 1,
        name: jianNames[i],
        short: jianNames[i]
      });
    }
  }

  // 花牌 财神 1张
  tiles.push({
    id: id++,
    type: TILE_TYPES.HUA,
    num: 1,
    name: '财神',
    short: '花',
    isHua: true
  });

  return tiles;
}

// 获取牌的排序键（用于手牌排序）
function getSortKey(tile) {
  const typeOrder = {
    [TILE_TYPES.WAN]: 0,
    [TILE_TYPES.TIAO]: 1,
    [TILE_TYPES.TONG]: 2,
    [TILE_TYPES.FENG]: 3,
    [TILE_TYPES.JIAN]: 4,
    [TILE_TYPES.HUA]: 5
  };
  return typeOrder[tile.type] * 100 + tile.num;
}

// 排序手牌
function sortTiles(tiles) {
  return [...tiles].sort((a, b) => getSortKey(a) - getSortKey(b));
}

// 判断两张牌是否同类同数（用于碰/杠判断）
function isSameTile(a, b) {
  return a.type === b.type && a.num === b.num;
}

// 获取牌的唯一标识键
function getTileKey(tile) {
  return tile.type + '_' + tile.num;
}

// 洗牌
function shuffleTiles(tiles) {
  const arr = [...tiles];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 掷骰子
function rollDice() {
  return [Math.ceil(Math.random() * 6), Math.ceil(Math.random() * 6)];
}

module.exports = {
  TILE_TYPES,
  createAllTiles,
  getSortKey,
  sortTiles,
  isSameTile,
  getTileKey,
  shuffleTiles,
  rollDice
};
