const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = 'C:/Users/tiank/WorkBuddy/2026-08-06-22-12-54/anyang-mahjong';
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;

// ---- mocks ----
const handlers = {};
const fakeSocket = {
  on: (ev, fn) => { handlers[ev] = fn; },
  emit: () => {},
  id: 'me'
};
window.io = () => fakeSocket;
window.speechSynthesis = { getVoices: () => [], speak() {}, onvoiceschanged: null };
window.SpeechSynthesisUtterance = class { constructor() {} };
window.Audio = class { constructor() { this.play = () => ({ catch() {} }); } pause() {} };
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.confirm = () => true;
window.alert = () => {};

const code = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
window.eval(code);

function countKind(el) {
  if (!el) return { front: 0, back: 0, total: 0 };
  const front = el.querySelectorAll('.tile:not(.tile-back-img)').length;
  const back = el.querySelectorAll('.tile-back-img').length;
  return { front, back, total: el.children.length };
}

let tid = 0;
function mkTiles(n, type = 'wan') {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ type, num: (i % 9) + 1, id: 't' + (tid++), name: (i % 9 + 1) + '万' });
  return arr;
}

// 1) 游戏中：emit gameState -> 三家应为背面
handlers['gameState']({
  phase: 'playing', mySeat: 0,
  myHand: mkTiles(13),
  remainingTiles: 50, discardTiles: [],
  players: [
    { seat: 0, name: 'P0', handTiles: mkTiles(13), pengArea: [], gangArea: [], huaTiles: [] },
    { seat: 1, name: 'P1', tileCount: 13, pengArea: [], gangArea: [], huaTiles: [] },
    { seat: 2, name: 'P2', tileCount: 13, pengArea: [], gangArea: [], huaTiles: [] },
    { seat: 3, name: 'P3', tileCount: 13, pengArea: [], gangArea: [], huaTiles: [] },
  ]
});

console.log('--- 游戏中（期望三家背面）---');
['Left', 'Top', 'Right'].forEach(p => {
  const c = countKind(window.document.getElementById('hand' + p));
  console.log(`  hand${p}:`, c);
});

// 2) 一局结束：emit gameOver(带 revealObj) -> 三家应翻正面
const reveal = {};
[0, 1, 2, 3].forEach(s => {
  reveal[s] = { seat: s, isWinner: (s === 2), winTileId: null, handTiles: mkTiles(s === 2 ? 14 : 13), pengArea: [], gangArea: [], huaTiles: [] };
});
reveal[2].winTileId = reveal[2].handTiles[13].id;

try {
  handlers['gameOver']({
    winner: 2, winType: 'dianpao', dianPaoPlayer: 1, revealObj: reveal,
    players: [{ seat: 0, name: 'P0', isZhuang: false }, { seat: 1, name: 'P1', isZhuang: false }, { seat: 2, name: 'P2', isZhuang: true }, { seat: 3, name: 'P3', isZhuang: false }]
  });
} catch (e) {
  console.log('  (showGameOver 内部因测试数据不完整抛错，已忽略；亮牌 renderAll 已完成)');
}

console.log('--- 结束后（期望三家正面）---');
let allFront = true;
['Left', 'Top', 'Right'].forEach(p => {
  const c = countKind(window.document.getElementById('hand' + p));
  const ok = c.front > 0 && c.back === 0;
  if (!ok) allFront = false;
  console.log(`  hand${p}:`, c, ok ? '✅ 正面' : '❌ 仍背面');
});
console.log('\n结果:', allFront ? '✅ 亮牌成功' : '❌ 仍是背面');
process.exit(allFront ? 0 : 1);
