// 安阳麻将前端逻辑
let socket = io();
let mySeat = 0;
let myRoomId = null;
let gameState = null;
// 开局发牌门控：掷骰定庄完成前，暂不显示/渲染手牌（先掷骰 → 再发牌动画 → 再开始）
let _awaitDiceRoll = false;
let _pendingYourTurn = null;  // 发牌前到达的“轮到你”事件，缓存待发牌后应用
// 一局结束“亮牌”：revealObj 为服务端推来的各家完整手牌；_revealed 为真时桌面正面展示
let _reveal = null;
let _revealed = false;

// 渲染缓存：避免每次状态更新都销毁重绘（缓解出牌后他人碰杠时的卡顿）
let _oppHandCounts = {};
let _meldSigs = {};
let _handSig = null;        // 我的手牌内容签名（含 最后摸牌/选中）
let _discardSig = null;     // 中央弃牌堆签名
let _infoSigs = {};         // 各家信息条签名（按座位）
function _resetRenderCaches() {
  _oppHandCounts = {};
  _meldSigs = {};
  _handSig = null;
  _discardSig = null;
  _infoSigs = {};
}

// ============ 音频系统 ============
// 1) 音效：素材 CC0，来自 GitHub code4fukui/sound-cc0
const SOUND_FILES = {
  draw: 'sounds/draw.wav',     // 摸牌
  discard: 'sounds/discard.wav', // 出牌
  peng: 'sounds/peng.wav',     // 碰
  gang: 'sounds/gang.wav',     // 杠
  hu: 'sounds/hu.wav',         // 胡
  ting: 'sounds/ting.wav',     // 报听
  click: 'sounds/click.wav',   // UI 点击
  deal: 'sounds/deal.wav'      // 发牌/洗牌
};
const _audioCache = {};
function _getAudio(name) {
  if (!_audioCache[name]) {
    const a = new Audio(SOUND_FILES[name]);
    a.volume = 0.55;
    _audioCache[name] = a;
  }
  return _audioCache[name];
}
let sfxOn = (localStorage.getItem('anyang_sfx') !== 'off');
let voiceOn = (localStorage.getItem('anyang_voice') !== 'off');
let bgmOn = (localStorage.getItem('anyang_bgm') !== 'off');

function playSound(name) {
  if (!sfxOn) return;
  const f = SOUND_FILES[name];
  if (!f) return;
  try {
    const a = _getAudio(name);
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {}); // 忽略自动播放策略限制
  } catch (e) { /* 忽略 */ }
}

// 2) 报牌名：主用「在线 Edge TTS 预生成」的本地 MP3（见下方 speakTile），兜底才用 Web Speech。
//    牌名本就是中文可读（如“三万”“东风”“红中”）；四座位分配男/女/童音色，一听即辨。
let _zhVoices = [];
function _refreshZhVoices() {
  if (!('speechSynthesis' in window)) return;
  _zhVoices = (speechSynthesis.getVoices() || []).filter(v => /zh/i.test(v.lang));
}
if ('speechSynthesis' in window) {
  _refreshZhVoices();
  speechSynthesis.onvoiceschanged = _refreshZhVoices;
}
// 性别 -> 语音名关键词（不同系统中文语音命名不一，尽力匹配；匹配不到则靠 pitch 模拟）
const _ROLE_VOICE_KW = {
  '男': /(kang|yunxi|yunyang|xiaoyi|male|男)/i,
  '女': /(xiao|hui|yao|yunxia|female|女)/i,
  '童': /(child|kid|tone|童|幼)/i
};
function _matchVoiceByRole(role) {
  const re = _ROLE_VOICE_KW[role];
  if (!re) return null;
  return _zhVoices.find(v => re.test(v.name)) || null;
}
// 座位(0自己/东, 1下家, 2对家, 3上家) -> 角色音色；pitch 0~2（男低/女中/童尖），rate 影响语速
const _SEAT_PROFILES = [
  { role: '女', pitch: 1.15, rate: 1.12 }, // 0 自己  —— 女声
  { role: '男', pitch: 0.65, rate: 1.05 }, // 1 下家  —— 男声（低沉）
  { role: '女', pitch: 1.30, rate: 1.15 }, // 2 对家  —— 女声（清亮）
  { role: '童', pitch: 1.70, rate: 1.22 }  // 3 上家  —— 童声（尖细）
];
function _voiceForSeat(seat) {
  const idx = ((seat % 4) + 4) % 4;
  const prof = _SEAT_PROFILES[idx] || _SEAT_PROFILES[0];
  // 多个中文语音：优先按角色性别匹配真实嗓；匹配不到则按座位轮换分配不同嗓；否则用 pitch 模拟
  let voice = null;
  if (_zhVoices.length > 1) {
    voice = _matchVoiceByRole(prof.role) || _zhVoices[((idx % _zhVoices.length) + _zhVoices.length) % _zhVoices.length];
  }
  return { voice, pitch: prof.pitch, rate: prof.rate };
}
// 2b) 报牌名优先用「在线 Edge TTS 预生成的本地语音」（音质好、男/女/童分明、零延迟）。
//     文件命名 voice/s{座位}_{牌名}.mp3，由 launcher/gen_voices.py 生成。
//     本地文件缺失/加载失败时，回退到浏览器 Web Speech 实时朗读（兜底，保证永远有声）。
const VOICE_DIR = 'voice/';
let _voiceAudio = null;
function _voiceUrl(seat, name) {
  const s = ((seat % 4) + 4) % 4;
  return VOICE_DIR + 's' + s + '_' + name + '.mp3';
}
function _speakFallback(name, seat) {
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(String(name));
    u.lang = 'zh-CN';
    const s = (typeof seat === 'number') ? seat : mySeat;
    const { voice, pitch, rate } = _voiceForSeat(s);
    u.pitch = pitch; u.rate = rate; u.volume = 1.0;
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  } catch (e) { /* 忽略 */ }
}
function speakTile(name, seat) {
  if (!voiceOn || !name) return;
  const s = (typeof seat === 'number') ? seat : mySeat;
  try {
    if (!_voiceAudio) _voiceAudio = new Audio();
    _voiceAudio.pause();                 // 打断上一张，避免快速出牌叠音
    _voiceAudio.src = _voiceUrl(s, name);
    _voiceAudio.volume = 0.95;
    _voiceAudio.onerror = () => _speakFallback(name, s); // 404 等回退
    const p = _voiceAudio.play();
    if (p && p.catch) p.catch(() => _speakFallback(name, s));
  } catch (e) {
    _speakFallback(name, s);
  }
}

// 3) 背景音乐：用户提供的视频音频（微信视频提取，已转 MP3），曲库共 3 首
const BGM_TRACKS = [
  { file: 'music/bgm_user.mp3', name: '曲目1' },
  { file: 'music/bgm_v1.mp3',   name: '曲目2' },
  { file: 'music/bgm_v2.mp3',   name: '曲目3' }
];
let _bgmAudio = null;
// 每次启动随机从曲目1/2/3 中选一首作为循环起点（不再记忆上次曲目）
let _bgmIdx = Math.floor(Math.random() * BGM_TRACKS.length);
// 播放模式：'seq'（默认）顺序播三首后循环；'single' 单曲循环，靠手动切换
let bgmMode = (function () {
  const m = localStorage.getItem('anyang_bgm_mode');
  return (m === 'single') ? 'single' : 'seq';
})();
function _ensureBgm() {
  if (!_bgmAudio) {
    _bgmAudio = new Audio(BGM_TRACKS[_bgmIdx].file);
    _bgmAudio.loop = false;        // 单曲/顺序都交给 ended 事件控制，便于切换模式即时生效
    _bgmAudio.volume = 0.32;
    _bgmAudio.addEventListener('ended', () => {
      if (bgmMode === 'single') {
        // 单曲循环：原地重播当前曲目
        const p = _bgmAudio.play();
        if (p && p.catch) p.catch(() => {});
      } else {
        // 顺序播放：播下一首，三首播完再从头循环
        _bgmIdx = (_bgmIdx + 1) % BGM_TRACKS.length;
        _bgmAudio.src = BGM_TRACKS[_bgmIdx].file;
        _updateBgmName();
        const p = _bgmAudio.play();
        if (p && p.catch) p.catch(() => {});
      }
    });
  }
}
function _startBgm() {
  if (!bgmOn || !BGM_TRACKS.length) return;
  _ensureBgm();
  // 仅当处于暂停态时才播放：关了再开能正确从原位置续播，首次手势启动也正常
  if (_bgmAudio.paused) {
    const p = _bgmAudio.play();
    if (p && p.catch) p.catch(() => {});
  }
}
function _stopBgm() {
  if (_bgmAudio) _bgmAudio.pause();
}
function toggleSfx() {
  sfxOn = !sfxOn;
  localStorage.setItem('anyang_sfx', sfxOn ? 'on' : 'off');
  const b = document.getElementById('sfxToggle');
  if (b) b.textContent = sfxOn ? '🔊' : '🔇';
}
function toggleVoice() {
  voiceOn = !voiceOn;
  localStorage.setItem('anyang_voice', voiceOn ? 'on' : 'off');
  const b = document.getElementById('voiceToggle');
  if (b) b.textContent = voiceOn ? '🗣' : '🤐';
}
function toggleBgm() {
  bgmOn = !bgmOn;
  localStorage.setItem('anyang_bgm', bgmOn ? 'on' : 'off');
  const b = document.getElementById('bgmToggle');
  if (b) b.textContent = bgmOn ? '🎵' : '🔕';
  if (bgmOn) _startBgm(); else _stopBgm();
}
// 切换背景音乐曲目（曲库循环）；重建 audio 以彻底切歌，避免续播旧曲
function cycleBgm(dir) {
  if (BGM_TRACKS.length <= 1) return;
  _bgmIdx = (_bgmIdx + dir + BGM_TRACKS.length) % BGM_TRACKS.length;
  _updateBgmName();
  if (_bgmAudio) { _bgmAudio.pause(); _bgmAudio = null; }
  if (bgmOn) _startBgm();
}
function _updateBgmName() {
  const el = document.getElementById('bgmName');
  if (el) el.textContent = BGM_TRACKS[_bgmIdx].name;
}
// 切换 BGM 播放模式：顺序循环(🔁) <-> 单曲循环(🔂)
function toggleBgmMode() {
  bgmMode = (bgmMode === 'seq') ? 'single' : 'seq';
  localStorage.setItem('anyang_bgm_mode', bgmMode);
  _updateBgmModeBtn();
  // 切到单曲模式立即原地重播当前曲，让“单曲循环”即时听感生效
  if (bgmOn && bgmMode === 'single' && _bgmAudio) {
    const p = _bgmAudio.play();
    if (p && p.catch) p.catch(() => {});
  }
}
function _updateBgmModeBtn() {
  const b = document.getElementById('bgmModeBtn');
  if (b) {
    b.textContent = bgmMode === 'seq' ? '🔁' : '🔂';
    b.title = bgmMode === 'seq' ? '播放模式：顺序循环（三首播完再循环）' : '播放模式：单曲循环（手动切换）';
  }
}
// 首次用户手势后自动启动 BGM（绕过浏览器自动播放限制）
function _kickBgmOnce() {
  if (bgmOn) _startBgm();
  document.removeEventListener('pointerdown', _kickBgmOnce);
  document.removeEventListener('keydown', _kickBgmOnce);
}
document.addEventListener('pointerdown', _kickBgmOnce);
document.addEventListener('keydown', _kickBgmOnce);

// 全局：点击按钮（非手牌）时播放 UI 音
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (b && !b.classList.contains('tile')) playSound('click');
});

// 初始同步按钮图标（与 localStorage 状态一致）
(function syncAudioIcons() {
  const set = () => {
    const s = document.getElementById('sfxToggle'); if (s) s.textContent = sfxOn ? '🔊' : '🔇';
    const v = document.getElementById('voiceToggle'); if (v) v.textContent = voiceOn ? '🗣' : '🤐';
    const m = document.getElementById('bgmToggle'); if (m) m.textContent = bgmOn ? '🎵' : '🔕';
    _updateBgmName();
    _updateBgmModeBtn();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', set);
  else set();
})();
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
  // 重连/再进：
  if (gameState && gameState.phase === 'rolling'
      && gameState.diceResults && gameState.diceResults.length) {
    // 正处“掷骰定庄”阶段（首盘尚未发牌）：补出掷骰覆盖层，等其点击确认
    _awaitDiceRoll = true;
    _emptyTable();
    showDiceRoll(gameState.diceResults, gameState.dealer, true);
  } else if (gameState && (gameState.phase === 'playing' || gameState.phase === 'finished')
      && gameState.diceResults && gameState.diceResults.length) {
    // 本局已开始且已掷骰：非阻塞补展示骰子结果（不卡对局）
    showDiceRoll(gameState.diceResults, gameState.dealer, false);
  }
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

// 掷骰子定庄动画（后端已算好结果，此处仅做视觉表现）
// 骰子点数 -> 3x3 点位（行优先 1..9）：用于 CSS 实物骰子
const DIE_PIPS = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9]
};
function _dieMarkup(n) {
  let pips = '';
  for (let i = 1; i <= 9; i++) pips += '<i class="pip"></i>';
  return '<span class="die" data-final="' + n + '">' + pips + '</span>';
}
function _setDieFace(el, n) {
  const on = DIE_PIPS[n] || DIE_PIPS[1];
  const pips = el.querySelectorAll('.pip');
  pips.forEach((p, idx) => { p.classList.toggle('on', on.indexOf(idx + 1) !== -1); });
}
// 展示掷骰界面（不自动滚动）——等待玩家点击“开始掷骰”
// 展示掷骰界面
// gated=true  ：开局第一盘——等待玩家点击“开始掷骰”才滚动定格（阻塞对局开始）
// gated=false ：重连/再进——本局骰子早已掷过，仅作非阻塞展示，约2.6s 后自动消失
function showDiceRoll(diceResults, dealer, gated) {
  const overlay = document.getElementById('diceOverlay');
  const box = document.getElementById('dicePlayers');
  const result = document.getElementById('diceResult');
  const btn = document.getElementById('diceRollBtn');
  if (!overlay || !box || !diceResults || !diceResults.length) return;
  box.innerHTML = '';
  result.textContent = '';
  // 暂存骰子数据；庄家暂不揭晓，等玩家点击掷骰后客户端再根据点数实时计算
  overlay.dataset.dice = JSON.stringify(diceResults);
  overlay.dataset.dealer = '';
  diceResults.forEach((dr) => {
    const ab = dr.detail || [1, 1];
    const a = ab[0], b = ab[1];
    const name = (gameState && gameState.players[dr.seat]) ? gameState.players[dr.seat].name : ('座位' + (dr.seat + 1));
    const div = document.createElement('div');
    div.className = 'dice-player';
    div.dataset.seat = String(dr.seat);   // 用于掷骰后高亮真正的庄家
    div.innerHTML = '<div class="dp-name">' + name + '</div>' +
      '<div class="dp-dice">' + _dieMarkup(a) + _dieMarkup(b) + '</div>' +
      '<div class="dp-total" style="display:none">=' + (a + b) + '</div>';
    box.appendChild(div);
  });
  if (gated) {
    // 开局：静止为 1 点，显示“开始掷骰”按钮，等待玩家点击
    if (btn) btn.classList.remove('hidden');
    box.querySelectorAll('.die').forEach((d) => { d.classList.remove('rolling'); _setDieFace(d, 1); });
    overlay.classList.remove('info');
    overlay.classList.add('show');
  } else {
    // 重连/再进：直接展示已掷结果（庄家由服务器同份骰子算出），不阻塞对局
    if (btn) btn.classList.add('hidden');
    box.querySelectorAll('.die').forEach((d) => { d.classList.remove('rolling'); _setDieFace(d, parseInt(d.dataset.final, 10) || 1); });
    box.querySelectorAll('.dp-total').forEach((t) => { t.style.display = 'block'; });
    let calcDealer = -1, maxTotal = -1;
    diceResults.forEach((dr) => {
      const t = (dr.detail && dr.detail.length === 2) ? (dr.detail[0] + dr.detail[1]) : 0;
      if (t > maxTotal) { maxTotal = t; calcDealer = dr.seat; }
    });
    box.querySelectorAll('.dice-player').forEach((p) => {
      p.classList.toggle('is-dealer', parseInt(p.dataset.seat, 10) === calcDealer);
    });
    const dealerName = (gameState && gameState.players[calcDealer]) ? gameState.players[calcDealer].name : ('座位' + (calcDealer + 1));
    result.textContent = '🎯 ' + dealerName + ' 坐庄（本局已掷骰）';
    overlay.classList.add('info');
    overlay.classList.add('show');
    setTimeout(() => { overlay.classList.remove('show', 'info'); }, 2600);
  }
}
// 玩家点击“开始掷骰”后真正滚动定格
function rollDiceNow() {
  const overlay = document.getElementById('diceOverlay');
  const box = document.getElementById('dicePlayers');
  const result = document.getElementById('diceResult');
  const btn = document.getElementById('diceRollBtn');
  if (btn) btn.classList.add('hidden');
  const diceEls = box.querySelectorAll('.die');
  diceEls.forEach((d) => d.classList.add('rolling'));
  const roll = setInterval(() => {
    diceEls.forEach((d) => _setDieFace(d, 1 + Math.floor(Math.random() * 6)));
  }, 80);
  setTimeout(() => {
    clearInterval(roll);
    diceEls.forEach((d) => { d.classList.remove('rolling'); _setDieFace(d, parseInt(d.dataset.final, 10) || 1); });
    box.querySelectorAll('.dp-total').forEach((t) => { t.style.display = 'block'; });
    // 掷完骰子，客户端根据各家真实点数重新计算庄家（点数最大者坐庄，平局取座位号小者）
    let dealer = -1, maxTotal = -1;
    try {
      const diceData = JSON.parse(overlay.dataset.dice || '[]');
      diceData.forEach((dr) => {
        const t = (dr.detail && dr.detail.length === 2) ? (dr.detail[0] + dr.detail[1]) : 0;
        if (t > maxTotal) { maxTotal = t; dealer = dr.seat; }
      });
    } catch (e) { dealer = (overlay.dataset.dealer ? parseInt(overlay.dataset.dealer, 10) : -1); }
    overlay.dataset.dealer = String(dealer);
    // 高亮真正的庄家卡片（掷骰前不亮，避免提前泄露）
    box.querySelectorAll('.dice-player').forEach((p) => {
      p.classList.toggle('is-dealer', parseInt(p.dataset.seat, 10) === dealer);
    });
    const dealerName = (gameState && gameState.players[dealer]) ? gameState.players[dealer].name : ('座位' + (dealer + 1));
    result.textContent = '🎯 ' + dealerName + ' 点数最大，坐庄！';
    // 掷骰定庄完成：先公布庄家，稍作停留让玩家看清，再通知服务端发牌并收起覆盖层
    showToast(`庄家：${dealerName}`, 'success');
    setTimeout(() => {
      // 告诉服务端：骰子已掷定，可以发牌了（服务端随后广播 gameState 触发发牌动画）
      socket.emit('confirmDice');
      overlay.classList.remove('show');
    }, 900);
  }, 1200);
}

// 清空桌面（手牌/碰杠/弃牌/闲家背面），发牌动画前调用
function _emptyTable() {
  const handArea = document.getElementById('handArea'); if (handArea) handArea.innerHTML = '';
  const center = document.getElementById('centerDiscard'); if (center) center.innerHTML = '';
  for (const pos of ['Bottom', 'Top', 'Left', 'Right']) {
    const h = document.getElementById('hand' + pos); if (h) h.innerHTML = '';
    const m = document.getElementById('meld' + pos); if (m) m.innerHTML = '';
    const d = document.getElementById('discard' + pos); if (d) d.innerHTML = '';
  }
  _resetRenderCaches();
}
// 发牌：播放发牌音效 + 快速发牌动画，再落子
function _renderDeal() {
  playSound('deal');
  document.body.classList.add('dealing');
  renderAll();
  requestAnimationFrame(() => { fitTable(); fitHand(); setTimeout(fitTable, 60); });
  // 动画结束后移除 class，避免后续出牌重绘时也带发牌动画
  setTimeout(() => document.body.classList.remove('dealing'), 900);
}

socket.on('gameStart', (data) => {
  _resetRenderCaches(); // 新一盘：清空渲染缓存，强制重绘手牌背面与碰杠区
  _revealed = false;    // 新一盘：退出“亮牌”展示，恢复对手背面牌
  _reveal = null;
  const rb = document.getElementById('resultBar');
  if (rb) rb.style.display = 'none';
  document.getElementById('readyArea').style.display = 'none';
  document.getElementById('displayRound').textContent = '第' + data.roundNumber + '盘';
  // 清空桌面：发牌动画前桌面上不应有任何手牌/弃牌
  _emptyTable();
  if (data.diceResults && data.diceResults.length) {
    // 第一盘：先掷骰子定庄，发牌延迟到玩家点击“开始掷骰”确认后（服务端才真正发牌）
    _awaitDiceRoll = true;
    _pendingYourTurn = null;
    showDiceRoll(data.diceResults, data.dealer, true);
    showToast(`第${data.roundNumber}盘开始！请点击“开始掷骰”定庄`, 'success');
  } else {
    // 第2盘起：庄家顺延，无需掷骰——直接等待服务端发牌（紧随的 gameState 带发牌动画）
    _awaitDiceRoll = true;
    _pendingYourTurn = null;
    showToast(`第${data.roundNumber}盘开始！`, 'success');
  }
});

socket.on('gameState', (state) => {
  gameState = state;
  if (_awaitDiceRoll) {
    // 此刻才是真正的“发牌”——掷骰定庄已完成，播放发牌动画并落子
    _awaitDiceRoll = false;
    _renderDeal();
    if (_pendingYourTurn) { _applyYourTurn(_pendingYourTurn); _pendingYourTurn = null; }
    return;
  }
  renderAll();
});

socket.on('yourTurn', (data) => {
  // 发牌动画完成前到达的“轮到你”先缓存，待发牌后再应用，避免提前可操作
  if (_awaitDiceRoll) { _pendingYourTurn = data; return; }
  _applyYourTurn(data);
});
function _applyYourTurn(data) {
  isMyTurn = true;
  mustDiscard = data.mustDiscard || false;
  if (data.drewTile) {
    showToast('你摸了一张牌', 'info');
    playSound('draw');
  }
  renderAll();
}

socket.on('tileDiscarded', (data) => {
  // 显示出牌动画
  const pos = getRelativeSeat(data.player);
  showToast(`${gameState.players[data.player].name} 出了 ${data.tile.name}`, 'info');
  playSound('discard');
  speakTile(data.tile.name, data.player); // 报牌名：按出牌人座位用不同音色朗读
});

socket.on('pengOccurred', (data) => {
  showToast(`${gameState.players[data.player].name} 碰！`, 'success');
  playSound('peng');
  speakTile('碰', data.player); // 按出牌人座位用其专属音色播报“碰”
});

socket.on('gangOccurred', (data) => {
  const gangType = data.type === 'an' ? '暗杠' : data.type === 'bugang' ? '补杠' : '明杠';
  showToast(`${gameState.players[data.player].name} ${gangType}！`, 'success');
  playSound('gang');
  // 三种杠各有专属播报：暗杠 / 明杠 / 补杠，按座位音色朗读
  speakTile(gangType, data.player);
});

socket.on('tenpaiReported', (data) => {
  showToast(`${gameState.players[data.player].name} 报听！`, 'info');
  playSound('ting');
  speakTile('听', data.player); // 按座位音色播报“听”
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
  _reveal = (data && data.revealObj) || null;
  _revealed = !!_reveal;
  isMyTurn = false;
  mustDiscard = false;
  selectedTileId = null;
  // 亮牌：把四位玩家的手牌都正面朝上铺在桌面上（覆盖掉对手的背面）
  if (_revealed) renderAll();
  showGameOver(data);
  if (data && data.winner !== undefined && data.winner >= 0) {
    playSound('hu');
    // 按胜者座位音色播报：自摸 → “自摸”，点炮 → “胡”
    speakTile(data.winType === 'zimo' ? '自摸' : '胡', data.winner);
  }
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

  // 渲染闲家手牌背面
  renderOpponentHands();

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

// 亮牌/自家手牌展示用：按 万/筒/条/风/箭/花 的顺序整理，使牌面阅读自然
const _TILE_TYPE_ORDER = { wan: 0, tong: 1, tiao: 2, feng: 3, jian: 4, hua: 5 };
function _sortTilesForDisplay(tiles) {
  return tiles.slice().sort((a, b) => {
    const ta = _TILE_TYPE_ORDER[a.type] != null ? _TILE_TYPE_ORDER[a.type] : 9;
    const tb = _TILE_TYPE_ORDER[b.type] != null ? _TILE_TYPE_ORDER[b.type] : 9;
    if (ta !== tb) return ta - tb;
    return a.num - b.num;
  });
}

function renderHand() {
  const handArea = document.getElementById('handArea');
  if (!handArea) return;

  // 一局结束“亮牌”时，用服务端推来的完整手牌（含胡牌那张），不再显示背面
  let hand = null;
  let winTileId = null;
  if (_revealed && _reveal && _reveal[mySeat]) {
    hand = _sortTilesForDisplay(_reveal[mySeat].handTiles);
    winTileId = _reveal[mySeat].winTileId;
  } else if (gameState && gameState.myHand) {
    hand = gameState.myHand;
  }

  if (!hand) {
    if (_handSig !== '') { handArea.innerHTML = ''; _handSig = ''; }
    return;
  }

  const lastDrawId = _revealed ? null : (gameState.lastDrawTile ? gameState.lastDrawTile.id : null);
  // 仅在手牌内容 / 最后摸牌 / 选中 发生变化时才重建，否则跳过（这是出牌后卡顿的主因）
  const sig = hand.map(t => t.id).join(',') + '|' + lastDrawId + '|' + selectedTileId;
  if (sig === _handSig) return;
  _handSig = sig;

  handArea.innerHTML = '';
  hand.forEach((tile, i) => {
    const el = createTileElement(tile, { hand: true });
    if (tile.id === lastDrawId) {
      el.classList.add('last-draw');
    }
    if (tile.id === selectedTileId) {
      el.classList.add('selected');
    }
    if (_revealed && tile.id === winTileId) {
      el.classList.add('win-tile'); // 高亮胡牌的那张
    }
    el.style.setProperty('--i', i);
    el.onclick = () => onTileClick(tile);
    handArea.appendChild(el);
  });
  fitHand();
}

// 碰杠区渲染：仅在某家碰杠内容变化时才重建，减少每次状态更新的 DOM 开销（缓解碰牌卡顿）
function renderMelds() {
  if (!gameState) return;

  const rebuild = (el, pengArea, gangArea, huaTiles) => {
    el.innerHTML = '';
    if (pengArea) {
      for (const peng of pengArea) {
        const group = document.createElement('div');
        group.className = 'meld-group';
        for (const t of peng.tiles) {
          group.appendChild(createTileElement(t, { small: true }));
        }
        el.appendChild(group);
      }
    }
    if (gangArea) {
      for (const gang of gangArea) {
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
        el.appendChild(group);
      }
    }
    // 财神（花牌）单独一组展示
    if (huaTiles && huaTiles.length) {
      const group = document.createElement('div');
      group.className = 'meld-group hua-group';
      for (const t of huaTiles) {
        group.appendChild(createTileElement(t, { small: true }));
      }
      el.appendChild(group);
    }
  };

  // 我的碰杠区（亮牌时从 reveal 取财神，否则取 gameState）
  const myHua = (_revealed && _reveal && _reveal[mySeat]) ? _reveal[mySeat].huaTiles : gameState.myHuaTiles;
  const meSig = JSON.stringify({ p: gameState.myPengArea, g: gameState.myGangArea, h: myHua });
  const meldBottom = document.getElementById('meldBottom');
  if (_meldSigs.bottom !== meSig) {
    _meldSigs.bottom = meSig;
    rebuild(meldBottom, gameState.myPengArea, gameState.myGangArea, myHua);
  }

  // 其他玩家的碰杠区
  for (const p of gameState.players) {
    if (!p || p.seat === mySeat) continue;
    const pos = getRelativeSeat(p.seat);
    const meldEl = document.getElementById('meld' + cap(pos));
    if (!meldEl) continue;
    const hua = (_revealed && _reveal && _reveal[p.seat]) ? _reveal[p.seat].huaTiles : [];
    const sig = JSON.stringify({ p: p.pengArea, g: p.gangArea, h: hua });
    if (_meldSigs[pos] === sig) continue; // 未变化，跳过重建
    _meldSigs[pos] = sig;
    rebuild(meldEl, p.pengArea, p.gangArea, hua);
  }
}

function renderDiscards() {
  const center = document.getElementById('centerDiscard');
  if (!center) return;

  if (!gameState || !gameState.discardTiles) {
    if (_discardSig !== '') { center.innerHTML = ''; _discardSig = ''; }
    return;
  }

  // 仅在弃牌堆内容变化时才重建（后期几十张牌每次全量重建是卡顿来源之一）
  const sig = gameState.discardTiles.map(d => d.tile.id).join(',');
  if (sig === _discardSig) {
    // 内容未变，但仍需保证最后的“当前张”高亮正确（极少变动，开销可忽略）
    return;
  }
  _discardSig = sig;

  // 所有玩家打出的牌，按出牌顺序集中显示在桌面中央
  const total = gameState.discardTiles.length;
  center.innerHTML = '';
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
    const html = `
      <div class="avatar">${me.name.charAt(0)}</div>
      <span class="name">${me.name}</span>
      ${me.isDealer ? '<span class="dealer-tag">庄</span>' : ''}
      ${gameState.isTenpai ? '<span class="ting-tag">听</span>' : ''}
      ${gameState.hasHua ? '<span class="hua-tag">财神</span>' : ''}
      <span class="score">${me.totalScore > 0 ? '+' : ''}${me.totalScore}</span>
    `;
    // 内容未变则跳过 innerHTML（仅当前回合高亮用 classList 轻量切换）
    if (_infoSigs.b !== html) { _infoSigs.b = html; el.innerHTML = html; }
    el.classList.toggle('current', gameState.currentPlayer === mySeat);
  }

  // 其他玩家
  for (const p of gameState.players) {
    if (!p || p.seat === mySeat) continue;
    const pos = getRelativeSeat(p.seat);
    const el = document.getElementById('info' + cap(pos));
    if (!el) continue;
    const html = `
      <div class="avatar">${p.isAI ? '🤖' : p.name.charAt(0)}</div>
      <span class="name">${p.name}</span>
      ${p.isAI ? '<span class="ai-tag">电脑</span>' : ''}
      ${p.isDealer ? '<span class="dealer-tag">庄</span>' : ''}
      ${p.isTenpai ? '<span class="ting-tag">听</span>' : ''}
      ${p.huaCount > 0 ? '<span class="hua-tag">财神</span>' : ''}
      <span class="score">${p.totalScore > 0 ? '+' : ''}${p.totalScore}</span>
    `;
    if (_infoSigs[pos] !== html) { _infoSigs[pos] = html; el.innerHTML = html; }
    el.classList.toggle('current', gameState.currentPlayer === p.seat);
  }
}

// 渲染闲家（其他三家）的手牌
//  - 正常对局：显示一排扣着的背面牌
//  - 一局结束“亮牌”：显示真实牌面（正面朝上），并高亮胡牌的那张
// 优化：仅在手牌数变化时才重建，避免每次状态更新都销毁重绘约 39 张牌导致碰牌等操作时卡顿
function renderOpponentHands() {
  if (!gameState || !gameState.players) return;
  for (const p of gameState.players) {
    if (!p || p.seat === mySeat) continue;
    const pos = getRelativeSeat(p.seat);
    const el = document.getElementById('hand' + cap(pos));
    if (!el) continue;

    let tiles = null;       // 亮牌时的真实牌面
    let winTileId = null;
    let count;
    if (_revealed && _reveal && _reveal[p.seat]) {
      tiles = _sortTilesForDisplay(_reveal[p.seat].handTiles);
      winTileId = _reveal[p.seat].winTileId;
      count = tiles.length;
    } else {
      count = p.tileCount || 0;
    }
    // 数量/状态未变则跳过重建（关键：revealed 类必须在“已成功渲染正面”之后才加，
    // 否则会在下面判断里误判为“已亮牌”而跳过重建，导致三家仍显示背面牌）
    const _alreadyRevealed = el.classList.contains('revealed');
    if (_alreadyRevealed && _revealed && el.childElementCount === count) continue;
    if (!_alreadyRevealed && !_revealed && _oppHandCounts[pos] === count && el.childElementCount === count) continue;
    _oppHandCounts[pos] = count;
    el.innerHTML = '';
    if (_revealed && tiles) {
      tiles.forEach((t, i) => {
        const e = createTileElement(t, { small: true });
        if (t.id === winTileId) e.classList.add('win-tile');
        e.style.setProperty('--i', i);
        el.appendChild(e);
      });
      el.classList.add('revealed');   // 正面渲染成功后才标记，供后续跳过判断
    } else {
      for (let i = 0; i < count; i++) {
        // 背面牌不需要真实牌面，createTileElement 在 back:true 时只用 back.svg
        const t = createTileElement(null, { small: true, back: true });
        t.style.setProperty('--i', i);
        el.appendChild(t);
      }
      el.classList.remove('revealed');
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

  // 结算框居中弹出（符合预期）；遮罩已改为半透明，刚亮出的各家手牌仍隐约可见。
  // 顶部结算条先在关闭弹窗后再出现，作为常驻摘要（点“查看结算”可重新打开）。
  const bar = document.getElementById('resultBar');
  const barText = document.getElementById('resultBarText');
  if (bar && barText) {
    barText.textContent = (data.winType === 'draw')
      ? '荒庄 · 庄家连庄'
      : (winnerEl.textContent + ' · 本局结束');
    bar.style.display = 'none';
  }
  modal.classList.add('active');
}

// 手动打开结算详情（点“查看结算”时）：此时才弹出全屏弹窗，属用户主动操作
function openResultModal() {
  const modal = document.getElementById('resultModal');
  if (modal) modal.classList.add('active');
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
  // 关闭结算框后，把顶部结算条作为常驻摘要显示（点“查看结算”可重新打开）
  if (id === 'resultModal') {
    const rb = document.getElementById('resultBar');
    const rbText = document.getElementById('resultBarText');
    if (rb && rbText && rbText.textContent.trim()) rb.style.display = 'flex';
  }
}

function leaveRoom() {
  if (!confirm('确定要离开房间吗？')) return;
  socket.emit('leaveRoom');
  myRoomId = null;
  gameState = null;
  _revealed = false;
  _reveal = null;
  const rb = document.getElementById('resultBar');
  if (rb) rb.style.display = 'none';
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
