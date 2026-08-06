// 安阳麻将前端逻辑
let socket = io();
let mySeat = 0;
let myRoomId = null;
let gameState = null;
let roomInfo = null;
let isMyTurn = false;
let pendingActions = [];
let selfActions = [];
let selectedTileId = null;
let mustDiscard = false;
let isReady = false;

// ============ 麻将牌渲染 ============

// 麻将牌面渲染缓存
const tileImageCache = new Map();

function getTileRect(options = {}) {
  if (options.hand) return { width: 40, height: 54 };
  if (options.small) return { width: 28, height: 38 };
  if (options.tiny) return { width: 22, height: 30 };
  return { width: 36, height: 48 };
}

// 牌 type/num -> SVG 牌面文件路径（来源 lietxia/mahjong_graphic）
function getTileImage(type, num) {
  if (type === 'wan') return 'tiles/' + num + 'm.svg';
  if (type === 'tong') return 'tiles/' + num + 'p.svg';
  if (type === 'tiao') return 'tiles/' + num + 's.svg';
  if (type === 'feng') return 'tiles/' + num + 'z.svg';
  if (type === 'jian') return 'tiles/' + ({ 1: '7z', 2: '6z', 3: '5z' })[num] + '.svg';
  if (type === 'hua') return 'tiles/caishen.svg';
  return 'tiles/back.svg';
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawTileFace(ctx, type, num, w, h) {
  const r = Math.min(w, h) * 0.08;

  // 象牙色牌面渐变
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#faf7ef');
  grad.addColorStop(0.5, '#f5f0e3');
  grad.addColorStop(1, '#ebe4d2');
  ctx.fillStyle = grad;
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.fill();

  // 牌面边框
  ctx.strokeStyle = '#c8b890';
  ctx.lineWidth = Math.max(1, w * 0.025);
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.stroke();

  // 内部浅色描边（仿麻将倒角）
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = Math.max(1, w * 0.015);
  roundRectPath(ctx, w * 0.04, h * 0.04, w * 0.92, h * 0.92, r * 0.7);
  ctx.stroke();

  if (type === 'wan') drawWan(ctx, num, w, h);
  else if (type === 'tong') drawTong(ctx, num, w, h);
  else if (type === 'tiao') drawTiao(ctx, num, w, h);
  else if (type === 'feng') drawFeng(ctx, num, w, h);
  else if (type === 'jian') drawJian(ctx, num, w, h);
  else if (type === 'hua') drawHua(ctx, w, h);
}

function drawWan(ctx, num, w, h) {
  ctx.fillStyle = '#b71c1c';
  ctx.font = 'bold ' + (Math.min(w, h) * 0.52) + 'px "KaiTi","STKaiti","楷体","SimSun",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num + '萬', w / 2, h / 2 + h * 0.02);
}

function drawFeng(ctx, num, w, h) {
  const chars = ['東', '南', '西', '北'];
  ctx.fillStyle = '#212121';
  ctx.font = 'bold ' + (Math.min(w, h) * 0.58) + 'px "KaiTi","STKaiti","楷体","SimSun",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(chars[num - 1], w / 2, h / 2 + h * 0.02);
}

function drawJian(ctx, num, w, h) {
  const chars = ['中', '發', '白'];
  const colors = ['#b71c1c', '#2e7d32', '#1565c0'];
  if (num === 3) {
    // 白板：蓝色方框
    ctx.strokeStyle = colors[num - 1];
    ctx.lineWidth = Math.max(2, w * 0.045);
    const rw = w * 0.42;
    const rh = h * 0.5;
    ctx.strokeRect(w / 2 - rw / 2, h / 2 - rh / 2, rw, rh);
  } else {
    ctx.fillStyle = colors[num - 1];
    ctx.font = 'bold ' + (Math.min(w, h) * 0.58) + 'px "KaiTi","STKaiti","楷体","SimSun",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(chars[num - 1], w / 2, h / 2 + h * 0.02);
  }
}

function drawCircle(ctx, x, y, r, colors) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colors[0];
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = colors[1];
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = colors[2];
  ctx.fill();
}

function getDotPositions(num, cx, cy, spacing) {
  const dx = spacing * 0.5;
  const dy = spacing * 0.65;
  switch (num) {
    case 1: return [{ x: cx, y: cy }];
    case 2: return [{ x: cx, y: cy - dy }, { x: cx, y: cy + dy }];
    case 3: return [{ x: cx, y: cy - dy }, { x: cx - dx, y: cy + dy * 0.45 }, { x: cx + dx, y: cy + dy * 0.45 }];
    case 4: return [{ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy - dy }, { x: cx - dx, y: cy + dy }, { x: cx + dx, y: cy + dy }];
    case 5: return getDotPositions(4, cx, cy, spacing).concat([{ x: cx, y: cy }]);
    case 6: return [
      { x: cx - dx, y: cy - dy }, { x: cx - dx, y: cy }, { x: cx - dx, y: cy + dy },
      { x: cx + dx, y: cy - dy }, { x: cx + dx, y: cy }, { x: cx + dx, y: cy + dy }
    ];
    case 7: return getDotPositions(6, cx, cy, spacing).concat([{ x: cx, y: cy - dy * 1.25 }]);
    case 8: return [
      { x: cx - dx, y: cy - dy }, { x: cx - dx, y: cy }, { x: cx - dx, y: cy + dy },
      { x: cx + dx, y: cy - dy }, { x: cx + dx, y: cy }, { x: cx + dx, y: cy + dy },
      { x: cx, y: cy - dy * 0.55 }, { x: cx, y: cy + dy * 0.55 }
    ];
    case 9: return [
      { x: cx - dx, y: cy - dy }, { x: cx - dx, y: cy }, { x: cx - dx, y: cy + dy },
      { x: cx, y: cy - dy }, { x: cx, y: cy }, { x: cx, y: cy + dy },
      { x: cx + dx, y: cy - dy }, { x: cx + dx, y: cy }, { x: cx + dx, y: cy + dy }
    ];
  }
  return [];
}

function drawTong(ctx, num, w, h) {
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.105;
  const colors = ['#1565c0', '#fff', '#c62828'];
  const positions = getDotPositions(num, cx, cy, r * 2.05);
  positions.forEach(p => drawCircle(ctx, p.x, p.y, r, colors));
}

function drawStick(ctx, x, y, sw, sh, color) {
  ctx.fillStyle = color;
  roundRectPath(ctx, x - sw / 2, y - sh / 2, sw, sh, sw / 2);
  ctx.fill();
  // 顶部高光
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  roundRectPath(ctx, x - sw / 2 + 1, y - sh / 2 + 1, sw * 0.35, sh - 2, sw / 4);
  ctx.fill();
}

function getStickPositions(num, cx, cy, dx, dy) {
  switch (num) {
    case 2: return [{ x: cx, y: cy - dy }, { x: cx, y: cy + dy }];
    case 3: return [{ x: cx, y: cy - dy }, { x: cx, y: cy }, { x: cx, y: cy + dy }];
    case 4: return [{ x: cx - dx, y: cy - dy }, { x: cx + dx, y: cy - dy }, { x: cx - dx, y: cy + dy }, { x: cx + dx, y: cy + dy }];
    case 5: return getStickPositions(4, cx, cy, dx, dy).concat([{ x: cx, y: cy }]);
    case 6: return [
      { x: cx - dx, y: cy - dy }, { x: cx - dx, y: cy }, { x: cx - dx, y: cy + dy },
      { x: cx + dx, y: cy - dy }, { x: cx + dx, y: cy }, { x: cx + dx, y: cy + dy }
    ];
    case 7: return getStickPositions(6, cx, cy, dx, dy).concat([{ x: cx, y: cy - dy * 1.25 }]);
    case 8: return [
      { x: cx - dx, y: cy - dy }, { x: cx - dx, y: cy }, { x: cx - dx, y: cy + dy },
      { x: cx + dx, y: cy - dy }, { x: cx + dx, y: cy }, { x: cx + dx, y: cy + dy },
      { x: cx, y: cy - dy * 0.55 }, { x: cx, y: cy + dy * 0.55 }
    ];
    case 9: return [
      { x: cx - dx, y: cy - dy }, { x: cx - dx, y: cy }, { x: cx - dx, y: cy + dy },
      { x: cx, y: cy - dy }, { x: cx, y: cy }, { x: cx, y: cy + dy },
      { x: cx + dx, y: cy - dy }, { x: cx + dx, y: cy }, { x: cx + dx, y: cy + dy }
    ];
  }
  return [];
}

function drawTiao(ctx, num, w, h) {
  const cx = w / 2, cy = h / 2;
  if (num === 1) {
    drawBird(ctx, cx, cy, w, h);
    return;
  }
  const sw = Math.max(2.5, w * 0.055);
  const sh = Math.min(w, h) * 0.17;
  const dx = sh * 0.42;
  const dy = sh * 0.58;
  const positions = getStickPositions(num, cx, cy, dx, dy);
  positions.forEach((p, i) => {
    const isRed = (num === 5 && i === 4) || (num === 7 && i === 6) || (num === 9 && i === 4);
    drawStick(ctx, p.x, p.y, sw, sh, isRed ? '#c62828' : '#2e7d32');
  });
}

function drawBird(ctx, cx, cy, w, h) {
  const s = Math.min(w, h) * 0.0065;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  // 身体
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath();
  ctx.ellipse(0, 6, 13, 23, 0, 0, Math.PI * 2);
  ctx.fill();
  // 翅膀
  ctx.fillStyle = '#1b5e20';
  ctx.beginPath();
  ctx.ellipse(8, 4, 7, 14, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // 头
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath();
  ctx.arc(-9, -20, 11, 0, Math.PI * 2);
  ctx.fill();
  // 冠
  ctx.fillStyle = '#c62828';
  ctx.beginPath();
  ctx.moveTo(-9, -32);
  ctx.lineTo(-4, -22);
  ctx.lineTo(-14, -22);
  ctx.fill();
  // 眼睛
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(-12, -22, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(-13, -22, 1.5, 0, Math.PI * 2);
  ctx.fill();
  // 嘴
  ctx.fillStyle = '#ff9800';
  ctx.beginPath();
  ctx.moveTo(-19, -20);
  ctx.lineTo(-28, -16);
  ctx.lineTo(-19, -12);
  ctx.fill();
  // 尾巴
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath();
  ctx.moveTo(10, 18);
  ctx.lineTo(26, 34);
  ctx.lineTo(6, 28);
  ctx.fill();
  // 腿
  ctx.strokeStyle = '#ff9800';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-5, 28);
  ctx.lineTo(-5, 37);
  ctx.moveTo(5, 28);
  ctx.lineTo(5, 37);
  ctx.stroke();
  ctx.restore();
}

function drawHua(ctx, w, h) {
  const r = Math.min(w, h) * 0.08;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#ffecb3');
  grad.addColorStop(0.5, '#ffd54f');
  grad.addColorStop(1, '#ffb300');
  ctx.fillStyle = grad;
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.fill();
  ctx.strokeStyle = '#f57c00';
  ctx.lineWidth = Math.max(1, w * 0.025);
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.stroke();
  ctx.fillStyle = '#b71c1c';
  ctx.font = 'bold ' + (Math.min(w, h) * 0.5) + 'px "KaiTi","STKaiti","楷体","SimSun",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('花', w / 2, h / 2 + h * 0.02);
}

// 中文牌名（鼠标悬停提示用）
function getTileName(tile) {
  if (!tile) return '';
  const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (tile.type === 'wan') return cn[tile.num - 1] + '万';
  if (tile.type === 'tong') return cn[tile.num - 1] + '筒';
  if (tile.type === 'tiao') return cn[tile.num - 1] + '条';
  if (tile.type === 'feng') return ['东', '南', '西', '北'][tile.num - 1] + '风';
  if (tile.type === 'jian') return ['红中', '发财', '白板'][tile.num - 1];
  if (tile.type === 'hua') return '财神';
  return '';
}

// ============ 桌面自适应缩放 ============
// 桌面按 760x470 设计尺寸绘制，根据容器实际大小等比缩放，保证任意屏幕完整显示
const DESIGN_W = 760;
const DESIGN_H = 470;
function fitTable() {
  const wrap = document.querySelector('.table-wrap');
  const table = document.querySelector('.mahjong-table');
  if (!wrap || !table) return;
  const aw = wrap.clientWidth;
  const ah = wrap.clientHeight;
  if (aw <= 0 || ah <= 0) return;
  const scale = Math.min(aw / DESIGN_W, ah / DESIGN_H);
  table.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
}

// 手牌自适应：牌多时自动缩小每张牌，避免出现横向滚动条
// （牌面用 background-size:contain 的 SVG，缩小 div 时牌面等比缩放仍清晰）
function fitHand() {
  const handArea = document.getElementById('handArea');
  if (!handArea) return;
  const tiles = handArea.querySelectorAll('.hand-tile');
  const n = tiles.length;
  if (!n) return;
  const cs = getComputedStyle(handArea);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const avail = handArea.clientWidth - padL - padR;
  if (avail <= 0) return;
  const gap = 3;
  const baseW = 48, baseH = 66, ratio = baseH / baseW;
  let lastExtra = 0;
  for (const t of tiles) { if (t.classList.contains('last-draw')) { lastExtra = 16; break; } }
  const totalBase = n * baseW + (n - 1) * gap + lastExtra;
  let w = baseW;
  if (totalBase > avail) {
    w = (avail - (n - 1) * gap - lastExtra) / n;
    if (w < 20) w = 20; // 最小宽度，保证可点
  }
  const h = w * ratio;
  for (const t of tiles) {
    t.style.width = w + 'px';
    t.style.height = h + 'px';
    if (t.classList.contains('last-draw')) {
      t.style.marginLeft = (w * 0.35 > 6 ? w * 0.35 : 6) + 'px';
    }
  }
}
window.addEventListener('resize', () => { fitTable(); fitHand(); });
window.addEventListener('orientationchange', () => { setTimeout(fitTable, 250); setTimeout(fitHand, 300); });
window.addEventListener('load', () => { fitTable(); fitHand(); });

// 触摸设备：点按牌时短暂显示牌名（手机无 hover）
function showTileNameToast(tile) {
  if (!window.matchMedia || !window.matchMedia('(hover: none)').matches) return;
  const name = getTileName(tile);
  if (name) showToast(name, 'info', 1100);
}

function createTileElement(tile, options = {}) {
  const div = document.createElement('div');
  div.className = 'tile tile-svg';
  if (options.small) div.className += ' tile-small';
  if (options.tiny) div.className += ' tile-tiny';
  if (options.hand) div.className += ' hand-tile';
  if (options.back) {
    div.className += ' tile-back-img';
    div.style.backgroundImage = "url('tiles/back.svg')";
  } else {
    const type = tile ? tile.type : 'wan';
    const num = tile ? tile.num : 1;
    const img = getTileImage(type, num);
    div.style.backgroundImage = "url('" + img + "')";
    if (tile) {
      const name = getTileName(tile);
      if (name) div.dataset.tileName = name;
    }
  }
  div.style.backgroundSize = 'contain';
  div.style.backgroundPosition = 'center';
  div.style.backgroundRepeat = 'no-repeat';
  if (tile && tile.id !== undefined) div.dataset.tileId = tile.id;
  return div;
}

// ============ 悬停牌名提示 ============
function initTileTooltip() {
  const tip = document.getElementById('tileTooltip');
  if (!tip) return;
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tile-name]');
    if (el && el.dataset.tileName) {
      tip.textContent = el.dataset.tileName;
      tip.style.display = 'block';
      moveTileTip(e);
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.style.display === 'block') moveTileTip(e);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tile-name]');
    if (el) tip.style.display = 'none';
  });
}

function moveTileTip(e) {
  const tip = document.getElementById('tileTooltip');
  if (!tip) return;
  let x = e.clientX + 14;
  let y = e.clientY + 14;
  const r = tip.getBoundingClientRect();
  if (x + r.width > window.innerWidth) x = e.clientX - r.width - 14;
  if (y + r.height > window.innerHeight) y = e.clientY - r.height - 14;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

// 注意：本脚本在 <body> 中 #tileTooltip 之前加载，直接执行会因元素尚不存在而失效，
// 因此等 DOM 解析完成后再初始化悬停提示
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTileTooltip);
} else {
  initTileTooltip();
}

// ============ 位置映射 ============

function getRelativeSeat(seat) {
  // 返回相对于我的位置: 'bottom'|'right'|'top'|'left'
  const diff = (seat - mySeat + 4) % 4;
  return ['bottom', 'right', 'top', 'left'][diff];
}

function getSeatByPosition(pos) {
  // 通过位置名称获取座位号
  const positions = ['bottom', 'right', 'top', 'left'];
  const diff = positions.indexOf(pos);
  return (mySeat + diff) % 4;
}

// ============ 大厅逻辑 ============

function createRoom() {
  const name = document.getElementById('playerNameInput').value.trim();
  const zuizi = parseInt(document.getElementById('zuiziSelect').value);
  socket.emit('createRoom', { zuizi: zuizi, name: name || undefined });
}

function joinRoom() {
  const roomId = document.getElementById('joinRoomId').value.trim();
  const name = document.getElementById('playerNameInput').value.trim();
  if (!roomId) { showToast('请输入房间号', 'error'); return; }
  socket.emit('joinRoom', { roomId, name: name || undefined });
}

function joinRoomFromList(roomId) {
  const name = document.getElementById('playerNameInput').value.trim();
  socket.emit('joinRoom', { roomId, name: name || undefined });
}

socket.on('joinedRoom', (data) => {
  mySeat = data.seat;
  myRoomId = data.roomId;
  document.getElementById('lobbyView').style.display = 'none';
  document.getElementById('gameView').classList.add('active');
  document.getElementById('displayRoomId').textContent = data.roomId;
  document.getElementById('displayZuizi').textContent = data.zuizi;
  document.getElementById('chatPanel').style.display = 'flex';
  document.getElementById('readyArea').style.display = 'block';
  gameState = data.gameState;
  renderAll();
  // 等待布局生效后再缩放桌面
  requestAnimationFrame(() => { fitTable(); fitHand(); setTimeout(fitTable, 60); });
});

socket.on('roomInfo', (info) => {
  roomInfo = info;
  renderRoomInfo();
});

socket.on('roomList', (rooms) => {
  renderRoomList(rooms);
});

socket.on('error', (data) => {
  showToast(data.message, 'error');
});

// 自动获取房间列表
setInterval(() => {
  if (document.getElementById('lobbyView').style.display !== 'none') {
    socket.emit('getRooms');
  }
}, 3000);

// 初始获取
socket.emit('getRooms');

function renderRoomList(rooms) {
  const el = document.getElementById('roomList');
  if (!rooms || rooms.length === 0) {
    el.innerHTML = '<div style="color:#666; font-size:13px; text-align:center; padding:20px;">暂无开放房间</div>';
    return;
  }
  el.innerHTML = rooms.map(r => `
    <div class="room-item">
      <span class="room-id">${r.roomId.substring(0, 12)}...</span>
      <span class="room-players">${r.playerCount}/4人</span>
      <span class="room-zuizi">${r.zuizi}分zuizi</span>
      <button class="btn btn-success" style="padding:4px 12px; font-size:12px;" 
        onclick="joinRoomFromList('${r.roomId}')" ${r.playerCount >= 4 ? 'disabled' : ''}>加入</button>
    </div>
  `).join('');
}

// ============ 房间信息渲染 ============

function renderRoomInfo() {
  if (!roomInfo) return;
  document.getElementById('displayRoomId').textContent = roomInfo.roomId;
  document.getElementById('displayZuizi').textContent = roomInfo.zuizi;
  document.getElementById('displayRound').textContent = '第' + (roomInfo.roundNumber || 0) + '盘';

  // 渲染玩家信息
  for (const p of roomInfo.players) {
    if (!p.name) continue;
    const pos = getRelativeSeat(p.seat);
    if (pos === 'bottom') continue; // 自己在底部单独渲染
    const el = document.getElementById('info' + cap(pos));
    if (el) {
      el.innerHTML = `
        <div class="avatar">${p.isAI ? '🤖' : p.name.charAt(0)}</div>
        <span class="name">${p.name}</span>
        ${p.isAI ? '<span class="ai-tag">电脑</span>' : ''}
        ${p.isDealer ? '<span class="dealer-tag">庄</span>' : ''}
        ${p.totalScore !== 0 ? `<span class="score">${p.totalScore > 0 ? '+' : ''}${p.totalScore}</span>` : ''}
        ${p.disconnected ? '<span style="color:#ef5350; font-size:10px;">断线</span>' : ''}
      `;
    }
  }

  // 显示准备按钮
  if (roomInfo.phase === 'waiting' || roomInfo.phase === 'finished') {
    document.getElementById('readyArea').style.display = 'block';
    const readyCount = roomInfo.players.filter(p => p.isReady).length;
    const humanCount = roomInfo.players.filter(p => p.name && !p.isAI).length;
    document.getElementById('waitingText').textContent = 
      readyCount < 4 ? `等待玩家准备 (${readyCount}/4)` : '';
    const btn = document.getElementById('readyBtn');
    const me = roomInfo.players.find(p => p.seat === mySeat);
    if (me) {
      btn.textContent = me.isReady ? '取消准备' : '准备';
      btn.className = me.isReady ? 'btn ready-btn' : 'btn btn-primary ready-btn';
      isReady = me.isReady;
    }
    // 添加电脑按钮：房间未满且自己是房主（seat 0）
    const addAiBtn = document.getElementById('addAiBtn');
    const currentCount = roomInfo.players.filter(p => p.name).length;
    if (currentCount < 4 && mySeat === 0) {
      addAiBtn.style.display = 'inline-block';
      addAiBtn.disabled = false;
    } else {
      addAiBtn.style.display = 'none';
    }
  } else {
    document.getElementById('readyArea').style.display = 'none';
  }
}

function toggleReady() {
  if (isReady) {
    socket.emit('unready');
  } else {
    socket.emit('ready');
  }
}

function addAI() {
  socket.emit('addAI');
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ============ 游戏状态渲染 ============

socket.on('gameStart', (data) => {
  showToast(`第${data.roundNumber}盘开始！庄家：${gameState ? gameState.players[data.dealer].name : ''}`, 'success');
  document.getElementById('readyArea').style.display = 'none';
  document.getElementById('displayRound').textContent = '第' + data.roundNumber + '盘';
  requestAnimationFrame(() => { fitTable(); fitHand(); setTimeout(fitTable, 60); });
});

socket.on('gameState', (state) => {
  gameState = state;
  renderAll();
});

socket.on('yourTurn', (data) => {
  isMyTurn = true;
  mustDiscard = data.mustDiscard || false;
  if (data.drewTile) {
    showToast('你摸了一张牌', 'info');
  }
  renderAll();
});

socket.on('tileDiscarded', (data) => {
  // 显示出牌动画
  const pos = getRelativeSeat(data.player);
  showToast(`${gameState.players[data.player].name} 出了 ${data.tile.name}`, 'info');
});

socket.on('pengOccurred', (data) => {
  showToast(`${gameState.players[data.player].name} 碰！`, 'success');
});

socket.on('gangOccurred', (data) => {
  const gangType = data.type === 'an' ? '暗杠' : data.type === 'bugang' ? '补杠' : '明杠';
  showToast(`${gameState.players[data.player].name} ${gangType}！`, 'success');
});

socket.on('tenpaiReported', (data) => {
  showToast(`${gameState.players[data.player].name} 报听！`, 'info');
});

socket.on('availableActions', (data) => {
  pendingActions = data.actions;
  renderActions();
});

socket.on('selfActions', (data) => {
  selfActions = data.actions;
  renderSelfActions();
});

socket.on('gameOver', (data) => {
  showGameOver(data);
});

socket.on('chatMessage', (data) => {
  appendChatMessage(data);
});

socket.on('playerDisconnected', (data) => {
  showToast(`${gameState.players[data.seat].name} 断线了`, 'error');
});

function renderAll() {
  if (!gameState) return;
  
  // 更新阶段显示
  const phaseText = {
    'waiting': '等待中',
    'rolling': '摇骰子',
    'dealing': '发牌中',
    'playing': '游戏中',
    'finished': '已结束'
  };
  document.getElementById('displayPhase').textContent = phaseText[gameState.phase] || gameState.phase;

  // 更新余牌数
  document.getElementById('remainingTiles').textContent = gameState.remainingTiles;

  // 渲染手牌
  renderHand();
  
  // 渲染碰杠区
  renderMelds();
  
  // 渲染弃牌区
  renderDiscards();
  
  // 渲染玩家信息
  renderPlayerInfos();

  // 隐藏操作按钮（会在selfActions/availableActions中重新显示）
  if (pendingActions.length === 0 && selfActions.length === 0) {
    document.getElementById('actionBar').style.display = 'none';
  }

  // 结束阶段显示常驻“再来一局”浮动按钮
  const fr = document.getElementById('newRoundFloat');
  if (fr) {
    const meP = gameState.players[mySeat];
    fr.style.display = (gameState.phase === 'finished' && meP && !meP.isAI) ? 'block' : 'none';
  }
}

function renderHand() {
  const handArea = document.getElementById('handArea');
  handArea.innerHTML = '';
  
  if (!gameState || !gameState.myHand) return;
  
  const hand = gameState.myHand;
  const lastDrawId = gameState.lastDrawTile ? gameState.lastDrawTile.id : null;

  hand.forEach((tile, i) => {
    const el = createTileElement(tile, { hand: true });
    if (tile.id === lastDrawId) {
      el.classList.add('last-draw');
    }
    if (tile.id === selectedTileId) {
      el.classList.add('selected');
    }
    el.onclick = () => onTileClick(tile);
    handArea.appendChild(el);
  });
  fitHand();
}

function renderMelds() {
  if (!gameState) return;
  
  // 我的碰杠区
  const meldBottom = document.getElementById('meldBottom');
  meldBottom.innerHTML = '';
  if (gameState.myPengArea) {
    for (const peng of gameState.myPengArea) {
      const group = document.createElement('div');
      group.className = 'meld-group';
      for (const t of peng.tiles) {
        group.appendChild(createTileElement(t, { small: true }));
      }
      meldBottom.appendChild(group);
    }
  }
  if (gameState.myGangArea) {
    for (const gang of gameState.myGangArea) {
      const group = document.createElement('div');
      group.className = 'meld-group';
      for (let i = 0; i < gang.tiles.length; i++) {
        const t = gang.tiles[i];
        if (gang.type === 'an' && i >= 3) {
          group.appendChild(createTileElement(t, { small: true, back: true }));
        } else {
          group.appendChild(createTileElement(t, { small: true }));
        }
      }
      meldBottom.appendChild(group);
    }
  }

  // 其他玩家的碰杠区
  for (const p of gameState.players) {
    if (!p || p.seat === mySeat) continue;
    const pos = getRelativeSeat(p.seat);
    const meldEl = document.getElementById('meld' + cap(pos));
    if (!meldEl) continue;
    meldEl.innerHTML = '';
    
    if (p.pengArea) {
      for (const peng of p.pengArea) {
        const group = document.createElement('div');
        group.className = 'meld-group';
        for (const t of peng.tiles) {
          group.appendChild(createTileElement(t, { small: true }));
        }
        meldEl.appendChild(group);
      }
    }
    if (p.gangArea) {
      for (const gang of p.gangArea) {
        const group = document.createElement('div');
        group.className = 'meld-group';
        for (let i = 0; i < gang.tiles.length; i++) {
          const t = gang.tiles[i];
          if (gang.type === 'an' && i >= 3) {
            group.appendChild(createTileElement(t, { small: true, back: true }));
          } else {
            group.appendChild(createTileElement(t, { small: true }));
          }
        }
        meldEl.appendChild(group);
      }
    }
  }
}

function renderDiscards() {
  const center = document.getElementById('centerDiscard');
  if (!center) return;
  center.innerHTML = '';
  if (!gameState || !gameState.discardTiles) return;

  // 所有玩家打出的牌，按出牌顺序集中显示在桌面中央
  const total = gameState.discardTiles.length;
  gameState.discardTiles.forEach((d, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'cd-tile cd-seat-' + d.player;
    if (idx === total - 1) wrap.className += ' last-cd';
    wrap.appendChild(createTileElement(d.tile, { tiny: true }));
    center.appendChild(wrap);
  });
  // 自动滚动到最新一张
  center.scrollTop = center.scrollHeight;

  // 各玩家原来的弃牌区不再单独显示（已统一到桌面中央）
  for (const pos of ['Top', 'Left', 'Right']) {
    const el = document.getElementById('discard' + pos);
    if (el) el.innerHTML = '';
  }
}

function renderPlayerInfos() {
  if (!gameState) return;
  
  // 自己的信息
  const me = gameState.players[mySeat];
  if (me) {
    const el = document.getElementById('infoBottom');
    el.innerHTML = `
      <div class="avatar">${me.name.charAt(0)}</div>
      <span class="name">${me.name}</span>
      ${me.isDealer ? '<span class="dealer-tag">庄</span>' : ''}
      ${gameState.isTenpai ? '<span class="ting-tag">听</span>' : ''}
      ${gameState.hasHua ? '<span class="hua-tag">财神</span>' : ''}
      <span class="score">${me.totalScore > 0 ? '+' : ''}${me.totalScore}</span>
    `;
    if (gameState.currentPlayer === mySeat) {
      el.classList.add('current');
    } else {
      el.classList.remove('current');
    }
  }

  // 其他玩家
  for (const p of gameState.players) {
    if (!p || p.seat === mySeat) continue;
    const pos = getRelativeSeat(p.seat);
    const el = document.getElementById('info' + cap(pos));
    if (!el) continue;
    el.innerHTML = `
      <div class="avatar">${p.isAI ? '🤖' : p.name.charAt(0)}</div>
      <span class="name">${p.name}</span>
      ${p.isAI ? '<span class="ai-tag">电脑</span>' : ''}
      ${p.isDealer ? '<span class="dealer-tag">庄</span>' : ''}
      ${p.isTenpai ? '<span class="ting-tag">听</span>' : ''}
      ${p.huaCount > 0 ? '<span class="hua-tag">财神</span>' : ''}
      <span class="score">${p.totalScore > 0 ? '+' : ''}${p.totalScore}</span>
    `;
    if (gameState.currentPlayer === p.seat) {
      el.classList.add('current');
    } else {
      el.classList.remove('current');
    }
  }
}

// ============ 出牌与操作 ============

function onTileClick(tile) {
  showTileNameToast(tile);
  if (!isMyTurn || !mustDiscard) {
    // 非出牌阶段，只是选中
    selectedTileId = (selectedTileId === tile.id) ? null : tile.id;
    renderHand();
    return;
  }
  
  // 出牌
  if (gameState.currentPlayer !== mySeat) return;
  
  // 如果选中的是同一张，确认出牌
  if (selectedTileId === tile.id) {
    socket.emit('discard', { tileId: tile.id });
    selectedTileId = null;
    isMyTurn = false;
    mustDiscard = false;
    selfActions = [];
    document.getElementById('actionBar').style.display = 'none';
  } else {
    selectedTileId = tile.id;
    renderHand();
  }
}

function renderActions() {
  const bar = document.getElementById('actionBar');
  bar.innerHTML = '';
  bar.style.display = 'flex';
  
  for (const action of pendingActions) {
    let btn;
    if (action.type === 'peng') {
      btn = createActionButton('碰', 'action-btn-peng', () => {
        socket.emit('peng');
        pendingActions = [];
        bar.style.display = 'none';
      });
    } else if (action.type === 'minggang') {
      btn = createActionButton('杠', 'action-btn-gang', () => {
        socket.emit('minggang');
        pendingActions = [];
        bar.style.display = 'none';
      });
    } else if (action.type === 'hu') {
      btn = createActionButton('胡', 'action-btn-hu', () => {
        socket.emit('hu');
        pendingActions = [];
        bar.style.display = 'none';
      });
    }
    if (btn) bar.appendChild(btn);
  }
  
  // 过按钮
  const passBtn = createActionButton('过', 'action-btn-pass', () => {
    socket.emit('pass');
    pendingActions = [];
    bar.style.display = 'none';
  });
  bar.appendChild(passBtn);
}

function renderSelfActions() {
  const bar = document.getElementById('actionBar');
  bar.innerHTML = '';
  
  let hasAction = false;
  
  for (const action of selfActions) {
    let btn;
    if (action.type === 'zimo') {
      btn = createActionButton('自摸', 'action-btn-zimo', () => {
        socket.emit('zimo');
        selfActions = [];
        bar.style.display = 'none';
      });
      hasAction = true;
    } else if (action.type === 'ting') {
      btn = createActionButton('报听', 'action-btn-ting', () => {
        showTingOptions(action.info);
        selfActions = [];
      });
      hasAction = true;
    } else if (action.type === 'angang') {
      // 收集所有暗杠选项
      const anGangActions = selfActions.filter(a => a.type === 'angang');
      if (anGangActions.length > 0 && !bar.querySelector('.action-btn-gang')) {
        btn = createActionButton('暗杠', 'action-btn-gang', () => {
          showAnGangOptions(anGangActions);
        });
        hasAction = true;
      }
    } else if (action.type === 'bugang') {
      const buGangActions = selfActions.filter(a => a.type === 'bugang');
      if (buGangActions.length > 0 && !bar.querySelector('.action-btn-gang')) {
        btn = createActionButton('补杠', 'action-btn-gang', () => {
          // 如果只有一个，直接执行
          if (buGangActions.length === 1) {
            socket.emit('bugang', { tileKey: buGangActions[0].tileKey });
            selfActions = [];
            bar.style.display = 'none';
          } else {
            showBuGangOptions(buGangActions);
          }
        });
        hasAction = true;
      }
    }
    if (btn) bar.appendChild(btn);
  }
  
  if (hasAction) {
    bar.style.display = 'flex';
  }
}

function createActionButton(text, cls, onclick) {
  const btn = document.createElement('button');
  btn.className = 'action-btn ' + cls;
  btn.textContent = text;
  btn.onclick = onclick;
  return btn;
}

// ============ 听牌选择 ============

function showTingOptions(info) {
  const modal = document.getElementById('tingModal');
  const optionsEl = document.getElementById('tingOptions');
  optionsEl.innerHTML = '';
  
  for (const opt of info.options) {
    const div = document.createElement('div');
    div.className = 'ting-option';
    
    // 显示要打出的牌
    const discardTile = gameState.myHand.find(t => t.id === opt.discardTileId);
    if (discardTile) {
      const label = document.createElement('span');
      label.textContent = '打出: ';
      label.style.fontSize = '12px';
      label.style.color = '#999';
      div.appendChild(label);
      div.appendChild(createTileElement(discardTile, { small: true }));
    }
    
    // 显示听的牌
    const tenpaiDiv = document.createElement('div');
    tenpaiDiv.className = 'tenpai-tiles';
    tenpaiDiv.style.marginLeft = '8px';
    const tingLabel = document.createElement('span');
    tingLabel.textContent = '听: ';
    tingLabel.style.fontSize = '12px';
    tingLabel.style.color = '#999';
    tenpaiDiv.appendChild(tingLabel);
    
    for (const t of opt.tenpaiTiles) {
      const tile = makeTileFromKeyLocal(t.key);
      const el = createTileElement(tile, { small: true });
      const typeLabel = document.createElement('span');
      typeLabel.style.fontSize = '10px';
      typeLabel.style.color = '#ffb300';
      typeLabel.textContent = t.type === 'bian' ? '边' : t.type === 'ka' ? '卡' : t.type === 'diao' ? '吊' : '';
      tenpaiDiv.appendChild(el);
      if (typeLabel.textContent) tenpaiDiv.appendChild(typeLabel);
    }
    div.appendChild(tenpaiDiv);
    
    div.onclick = () => {
      socket.emit('ting', { discardTileId: opt.discardTileId });
      closeModal('tingModal');
      isMyTurn = false;
      mustDiscard = false;
      document.getElementById('actionBar').style.display = 'none';
    };
    optionsEl.appendChild(div);
  }
  
  modal.classList.add('active');
}

function makeTileFromKeyLocal(key) {
  const [type, numStr] = key.split('_');
  const num = parseInt(numStr);
  const names = {
    wan: num + '万', tiao: num + '条', tong: num + '筒',
    feng: ['东', '南', '西', '北'][num - 1],
    jian: ['中', '发', '白'][num - 1]
  };
  return { type, num, name: names[type] || key, id: -1 };
}

// ============ 暗杠选择 ============

function showAnGangOptions(actions) {
  const modal = document.getElementById('anGangModal');
  const optionsEl = document.getElementById('anGangOptions');
  optionsEl.innerHTML = '';
  
  for (const action of actions) {
    const div = document.createElement('div');
    div.className = 'ting-option';
    div.style.alignItems = 'center';
    
    const label = document.createElement('span');
    label.textContent = '暗杠: ';
    label.style.fontSize = '12px';
    label.style.color = '#999';
    div.appendChild(label);
    
    const tile = makeTileFromKeyLocal(action.tileKey);
    // 显示4张
    for (let i = 0; i < 4; i++) {
      div.appendChild(createTileElement(tile, { small: true }));
    }
    
    div.onclick = () => {
      socket.emit('angang', { tileKey: action.tileKey });
      closeModal('anGangModal');
      selfActions = [];
      document.getElementById('actionBar').style.display = 'none';
    };
    optionsEl.appendChild(div);
  }
  
  modal.classList.add('active');
}

function showBuGangOptions(actions) {
  const modal = document.getElementById('anGangModal');
  document.querySelector('#anGangModal h2').textContent = '选择补杠';
  const optionsEl = document.getElementById('anGangOptions');
  optionsEl.innerHTML = '';
  
  for (const action of actions) {
    const div = document.createElement('div');
    div.className = 'ting-option';
    div.style.alignItems = 'center';
    
    const label = document.createElement('span');
    label.textContent = '补杠: ';
    label.style.fontSize = '12px';
    label.style.color = '#999';
    div.appendChild(label);
    
    const tile = makeTileFromKeyLocal(action.tileKey);
    div.appendChild(createTileElement(tile, { small: true }));
    
    div.onclick = () => {
      socket.emit('bugang', { tileKey: action.tileKey });
      closeModal('anGangModal');
      document.querySelector('#anGangModal h2').textContent = '选择暗杠';
      selfActions = [];
      document.getElementById('actionBar').style.display = 'none';
    };
    optionsEl.appendChild(div);
  }
  
  modal.classList.add('active');
}

// ============ 游戏结束 ============

function showGameOver(data) {
  const modal = document.getElementById('resultModal');
  const title = document.getElementById('resultTitle');
  const winnerEl = document.getElementById('resultWinner');
  const detailEl = document.getElementById('resultDetail');
  const tableEl = document.getElementById('resultTable');
  
  if (data.winType === 'draw') {
    title.textContent = '荒庄';
    winnerEl.textContent = '无人胡牌，庄家连庄';
    detailEl.textContent = '';
  } else {
    const winnerName = data.players[data.winner].name;
    if (data.winType === 'zimo') {
      title.textContent = '自摸！';
      winnerEl.textContent = winnerName + ' 自摸！';
    } else {
      title.textContent = '胡牌！';
      const dianPaoName = data.players[data.dianPaoPlayer].name;
      winnerEl.textContent = winnerName + ' 胡！点炮: ' + dianPaoName;
    }
    
    // 详情
    const d = data.huDetail;
    let detail = '';
    if (d.isZhuang) detail += '庄家 ';
    if (d.hasHua) detail += '财神 ';
    const typeNames = { bian: '边', ka: '卡', diao: '吊', normal: '平胡', qixingdui: '七对' };
    detail += typeNames[d.huType] || d.huType;
    detailEl.textContent = detail;
  }
  
  // 分数表
  let html = '<tr><th>玩家</th><th>本局</th><th>总分</th></tr>';
  for (const p of data.players) {
    if (!p) continue;
    const score = data.netScores[p.seat] || 0;
    html += `<tr>
      <td>${p.name}</td>
      <td class="${score > 0 ? 'score-positive' : score < 0 ? 'score-negative' : ''}">${score > 0 ? '+' : ''}${score}</td>
      <td class="${p.totalScore > 0 ? 'score-positive' : p.totalScore < 0 ? 'score-negative' : ''}">${p.totalScore > 0 ? '+' : ''}${p.totalScore}</td>
    </tr>`;
  }
  tableEl.innerHTML = html;
  
  // 显示开始新局按钮（任意真人玩家都可开新局）
  const newRoundBtn = document.getElementById('newRoundBtn');
  const me = data.players[mySeat];
  if (me && !me.isAI) {
    newRoundBtn.style.display = 'block';
    newRoundBtn.textContent = (me.seat === gameState.dealer) ? '开始新盘（庄家）' : '再来一局';
  } else {
    newRoundBtn.style.display = 'none';
  }
  
  modal.classList.add('active');
}

function startNewRound() {
  socket.emit('newRound');
  closeModal('resultModal');
}

// ============ 聊天 ============

function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('chat', { message: msg });
  input.value = '';
}

function appendChatMessage(data) {
  const el = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-name">${data.name}:</span> ${data.message}`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ============ 工具函数 ============

function showToast(msg, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function leaveRoom() {
  if (!confirm('确定要离开房间吗？')) return;
  socket.emit('leaveRoom');
  myRoomId = null;
  gameState = null;
  document.getElementById('gameView').classList.remove('active');
  document.getElementById('lobbyView').style.display = 'flex';
  document.getElementById('chatPanel').style.display = 'none';
  document.getElementById('readyArea').style.display = 'none';
  socket.emit('getRooms');
}

// 点击遮罩关闭弹窗
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) el.classList.remove('active');
  });
});
