/**
 * 单机模式适配层（GitHub Pages 静态部署用）
 *
 * 原理：GitHub Pages 只能托管静态文件，跑不了 Node + Socket.io。
 * 这里实现一个"伪 socket"，接口与 socket.io 客户端一致（on / emit / off），
 * 内部把事件转发给浏览器内的 LocalGame 引擎。
 * 这样 app.js 一行都不用改，就能在纯静态环境下运行。
 *
 * 启用条件（满足任一）：
 *   1. socket.io 脚本加载失败（window.__NO_SERVER__ === true）
 *   2. 页面 URL 带 ?solo=1
 *   3. 页面不是 http(s) 协议（file:// 直接打开）
 */
(function (global) {
  'use strict';

  function wantSolo() {
    if (global.__FORCE_SOLO__) return true;
    if (/[?&]solo=1/.test(global.location.search)) return true;
    if (global.__NO_SERVER__) return true;
    if (typeof global.io === 'undefined') return true;
    return false;
  }

  class SoloSocket {
    constructor() {
      this.handlers = new Map();
      this.game = null;
      this.connected = true;
      this.id = 'solo-local';
      // 让 app.js 里 socket.on('connect') 之类的回调有机会执行
      setTimeout(() => this._fire('connect'), 0);
    }

    on(event, fn) {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event).push(fn);
      return this;
    }
    off(event, fn) {
      if (!this.handlers.has(event)) return this;
      if (!fn) this.handlers.delete(event);
      else this.handlers.set(event, this.handlers.get(event).filter(f => f !== fn));
      return this;
    }
    _fire(event, data) {
      const list = this.handlers.get(event);
      if (!list) return;
      for (const fn of list.slice()) {
        try { fn(data); } catch (e) { console.error('[solo] 处理 ' + event + ' 出错', e); }
      }
    }
    // 引擎产生的事件异步派发，避免在引擎调用栈里重入
    _emitToUI(event, data) {
      setTimeout(() => this._fire(event, data), 0);
    }

    emit(event, data) {
      data = data || {};
      switch (event) {
        case 'createRoom':
        case 'joinRoom':
          this._startGame(data);
          return this;
        case 'getRooms':
          // 大厅里显示一个虚拟房间，点进去即开局
          this._emitToUI('roomList', [{
            roomId: '单机', playerCount: 1, maxPlayers: 4,
            zuizi: 10, phase: 'waiting', hostName: '本地对局'
          }]);
          return this;
        case 'ready':
        case 'unready':
        case 'addAI':
        case 'leaveRoom':
          if (event === 'leaveRoom') global.location.reload();
          return this;
        case 'chat':
          this._emitToUI('chatMessage', {
            player: 0, name: (this.game && this.game.players[0].name) || '我',
            message: data.message, time: Date.now()
          });
          return this;
        default:
          // 其余全部是对局操作，交给引擎
          if (this.game) this.game.handleEmit(event, data);
          return this;
      }
    }

    _startGame(opts) {
      const zuizi = parseInt(opts.zuizi) || 10;
      const name = (opts.name && String(opts.name).trim()) || '我';
      if (typeof global.LocalGame !== 'function') {
        this._emitToUI('error', { message: '单机引擎未加载，请检查 js/engine.js' });
        return;
      }
      // AI 思考延时：默认 650ms 让出牌节奏可见；
      // 可用 ?speed=0 或 window.__SOLO_DELAY__ 覆盖（自动化测试用）
      let delay = 650;
      const m = /[?&]speed=(\d+)/.exec(global.location.search || '');
      if (m) delay = parseInt(m[1]);
      if (typeof global.__SOLO_DELAY__ === 'number') delay = global.__SOLO_DELAY__;

      this.game = new global.LocalGame({
        zuizi: zuizi,
        myName: name,
        delay: delay,
        onEmit: (ev, payload) => this._emitToUI(ev, payload)
      });
      this.game.start();
    }
  }

  if (wantSolo()) {
    const realIo = global.io;
    global.io = function () { return new SoloSocket(); };
    global.io.__solo = true;
    global.io.__real = realIo;
    global.__SOLO_MODE__ = true;
    console.log('[solo] 已启用单机模式（无后端）');
  }
})(window);
