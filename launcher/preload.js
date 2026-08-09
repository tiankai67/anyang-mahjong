// 向游戏页面注入一个可拖拽的无边框标题栏 + 最小化/最大化/关闭按钮
// 同时把游戏自身已有的顶栏下移，避免遮挡底部手牌
const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  // 让游戏自身顶栏下移，给无边框标题栏让位（不裁剪底部手牌）
  const style = document.createElement('style');
  style.textContent = `
    .top-bar { top: 28px !important; }
    #gameView { padding-top: 72px !important; }
    #app-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: 28px;
      z-index: 2147483647; display: flex; align-items: center;
      justify-content: space-between; padding: 0 8px;
      background: rgba(18,18,18,0.94); color: #eee;
      font: 13px/28px "Microsoft YaHei", system-ui, sans-serif;
      -webkit-app-region: drag; cursor: default; user-select: none;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    #app-titlebar .t-btns { -webkit-app-region: no-drag; }
    #app-titlebar button {
      background: #333; color: #eee; border: none; width: 30px; height: 22px;
      margin-left: 4px; border-radius: 4px; cursor: pointer; font-size: 14px; line-height: 1;
    }
    #app-titlebar button:hover { background: #555; }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'app-titlebar';
  bar.innerHTML =
    '<span class="t-title">安阳麻将</span>' +
    '<span class="t-btns">' +
    '<button data-act="min" title="最小化">—</button>' +
    '<button data-act="max" title="最大化">▢</button>' +
    '<button data-act="close" title="关闭">×</button>' +
    '</span>';
  document.body.appendChild(bar);

  bar.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => ipcRenderer.send('win-' + b.dataset.act));
  });
});
