// 测试核心游戏逻辑
const logic = require('./src/gameLogic');
const { createAllTiles, getTileKey, sortTiles } = require('./src/tiles');

function makeTile(type, num) {
  const names = {
    wan: num + '万', tiao: num + '条', tong: num + '筒',
    feng: ['东', '南', '西', '北'][num - 1] + '风',
    jian: ['中', '发', '白'][num - 1]
  };
  return { id: Math.random() * 10000, type, num, name: names[type] || '' };
}

function makeTiles(arr) {
  return arr.map(([type, num]) => makeTile(type, num));
}

console.log('=== 测试1：标准胡牌 ===');
let tiles = makeTiles([
  ['wan', 1], ['wan', 1], ['wan', 1],
  ['wan', 2], ['wan', 3], ['wan', 4],
  ['tiao', 2], ['tiao', 3], ['tiao', 4],
  ['tong', 5], ['tong', 6], ['tong', 7],
  ['feng', 1], ['feng', 1]
]);
console.log('canHu:', logic.canHu(tiles, 0, 0));

console.log('=== 测试2：七对 ===');
let pairs = makeTiles([
  ['wan', 1], ['wan', 1],
  ['wan', 2], ['wan', 2],
  ['tiao', 3], ['tiao', 3],
  ['tong', 4], ['tong', 4],
  ['feng', 1], ['feng', 1],
  ['feng', 2], ['feng', 2],
  ['jian', 1], ['jian', 1]
]);
console.log('canHu(七对):', logic.canHu(pairs, 0, 0));

console.log('=== 测试3：边 ===');
let bianTiles = makeTiles([
  ['wan', 1], ['wan', 2],
  ['wan', 4], ['wan', 5], ['wan', 6],
  ['tiao', 2], ['tiao', 3], ['tiao', 4],
  ['tong', 5], ['tong', 6], ['tong', 7],
  ['feng', 1], ['feng', 1]
]);
let huTile = makeTile('wan', 3);
let huTiles = [...bianTiles, huTile];
console.log('canHu:', logic.canHu(huTiles, 0, 0));
console.log('huType:', logic.getHuType(huTiles, huTile, 0, 0));

console.log('=== 测试4：卡 ===');
let kaTiles = makeTiles([
  ['wan', 5], ['wan', 7],
  ['wan', 1], ['wan', 2], ['wan', 3],
  ['tiao', 2], ['tiao', 3], ['tiao', 4],
  ['tong', 5], ['tong', 6], ['tong', 7],
  ['feng', 1], ['feng', 1]
]);
let kaHu = makeTile('wan', 6);
let kaHuTiles = [...kaTiles, kaHu];
console.log('canHu:', logic.canHu(kaHuTiles, 0, 0));
console.log('huType(卡):', logic.getHuType(kaHuTiles, kaHu, 0, 0));

console.log('=== 测试5：吊 ===');
let diaoTiles = makeTiles([
  ['wan', 1], ['wan', 2], ['wan', 3],
  ['tiao', 2], ['tiao', 3], ['tiao', 4],
  ['tong', 5], ['tong', 6], ['tong', 7],
  ['feng', 1], ['feng', 1], ['feng', 1],
  ['jian', 1]
]);
let diaoHu = makeTile('jian', 1);
let diaoHuTiles = [...diaoTiles, diaoHu];
console.log('canHu:', logic.canHu(diaoHuTiles, 0, 0));
console.log('huType(吊):', logic.getHuType(diaoHuTiles, diaoHu, 0, 0));

console.log('=== 测试6：听牌 ===');
let tenpaiTiles = makeTiles([
  ['wan', 1], ['wan', 2], ['wan', 3],
  ['tiao', 2], ['tiao', 3], ['tiao', 4],
  ['tong', 5], ['tong', 6], ['tong', 7],
  ['feng', 1], ['feng', 1], ['feng', 1],
  ['jian', 1]
]);
let tenpai = logic.getTenpai(tenpaiTiles, 0, 0);
console.log('听牌:', tenpai.map(t => t.key + '(' + t.type + ')'));

console.log('=== 测试7：碰/杠判断 ===');
let hand = makeTiles([['wan', 1], ['wan', 1], ['wan', 1], ['tiao', 5]]);
let testTile = makeTile('wan', 1);
console.log('canPeng:', logic.canPeng(hand, testTile));
console.log('canMingGang:', logic.canMingGang(hand, testTile));

console.log('=== 测试8：牌数 ===');
let allTiles = createAllTiles();
console.log('总牌数:', allTiles.length, '(应为137)');
console.log('花牌数:', allTiles.filter(t => t.isHua).length, '(应为1)');

console.log('=== 测试9：计分 ===');
const scoreResult = logic.calculateScore({
  winner: 0,
  dianPaoPlayer: 1,
  isZhuang: true,
  isZimo: false,
  hasHua: false,
  huType: 'normal',
  gangScores: {},
  zuizi: 10,
  players: [
    { id: 0, isZhuang: true },
    { id: 1, isZhuang: false },
    { id: 2, isZhuang: false },
    { id: 3, isZhuang: false }
  ]
});
console.log('庄家点炮胡(10分嘴子):', scoreResult.netScores);

const zimoResult = logic.calculateScore({
  winner: 1,
  dianPaoPlayer: null,
  isZhuang: false,
  isZimo: true,
  hasHua: true,
  huType: 'bian',
  gangScores: {},
  zuizi: 10,
  players: [
    { id: 0, isZhuang: true },
    { id: 1, isZhuang: false },
    { id: 2, isZhuang: false },
    { id: 3, isZhuang: false }
  ]
});
console.log('闲家自摸+财神+边(10分嘴子):', zimoResult.netScores);

console.log('\n=== 所有测试完成 ===');
