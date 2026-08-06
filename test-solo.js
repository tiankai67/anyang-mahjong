// 单机适配层冒烟测试：在 Node 里模拟浏览器全局，验证伪 socket 能驱动完整对局
const fs = require('fs');
const vm = require('vm');

// 构造一个最小浏览器环境
const win = {
  location: { search: '?solo=1', reload: () => { } },
  console, setTimeout, clearTimeout, setInterval, clearInterval
};
win.window = win;
const ctx = vm.createContext(win);

vm.runInContext(fs.readFileSync('./public/js/engine.js', 'utf8'), ctx, { filename: 'engine.js' });
vm.runInContext(fs.readFileSync('./public/js/solo.js', 'utf8'), ctx, { filename: 'solo.js' });

console.log('LocalGame 已挂载 =', typeof win.LocalGame === 'function');
console.log('io 已被单机层接管 =', win.io && win.io.__solo === true);
console.log('__SOLO_MODE__ =', win.__SOLO_MODE__);

win.__SOLO_DELAY__ = 0; // 关掉 AI 思考延时，测试跑满速
const socket = win.io();
const seen = {};
const mark = (e) => { seen[e] = (seen[e] || 0) + 1; };

let state = null;
let rounds = 0;
const DONE = 3;

['joinedRoom', 'gameStart', 'gameState', 'yourTurn', 'tileDiscarded', 'pengOccurred',
  'gangOccurred', 'tenpaiReported', 'availableActions', 'selfActions', 'gameOver', 'error', 'roomList', 'chatMessage']
  .forEach(ev => socket.on(ev, (d) => {
    mark(ev);
    if (ev === 'error') console.log('  [error]', d.message);
    if (ev === 'gameState') state = d;
    if (ev === 'selfActions') {
      const a = d.actions;
      if (a.some(x => x.type === 'zimo')) socket.emit('zimo');
      else if (a.some(x => x.type === 'ting')) { const t = a.find(x => x.type === 'ting'); socket.emit('ting', { discardTileId: t.info.options[0].discardTileId }); }
      else {
        const h = state && state.myHand;
        const last = state && state.lastDrawTile;
        const id = last ? last.id : (h && h.length ? h[h.length - 1].id : null);
        if (id != null) socket.emit('discard', { tileId: id });
      }
    }
    if (ev === 'availableActions') {
      if (d.actions.some(x => x.type === 'hu')) socket.emit('hu'); else socket.emit('pass');
    }
    if (ev === 'gameOver') {
      rounds++;
      console.log('  第' + rounds + '局结束: ' + d.winType + (d.winner >= 0 ? ' 赢家=座位' + d.winner : ''));
      if (rounds < DONE) socket.emit('newRound');
      else finish();
    }
  }));

function finish() {
  console.log('\n事件覆盖情况:');
  for (const k of Object.keys(seen)) console.log('  ' + k + ' x' + seen[k]);
  const must = ['joinedRoom', 'gameStart', 'gameState', 'yourTurn', 'tileDiscarded', 'selfActions', 'gameOver'];
  const miss = must.filter(m => !seen[m]);
  console.log(miss.length ? '\n缺失关键事件: ' + miss.join(', ') : '\n关键事件齐全，单机链路打通');
  process.exit(miss.length ? 1 : 0);
}

socket.emit('getRooms');
socket.emit('createRoom', { zuizi: 20, name: '测试玩家' });
socket.emit('chat', { message: '你好' });

setTimeout(() => { console.log('超时：只完成 ' + rounds + ' 局'); finish(); }, 30000);
