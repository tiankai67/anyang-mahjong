# 安阳麻将 · Anyang Mahjong

河南安阳地方麻将（**互报互飞**）的网页实现。既能作为 Node 服务开房联机，也能作为纯静态页面单机对战 3 个 AI。

**[在线试玩（单机版）](https://tiankai67.github.io/anyang-mahjong/)**

A web implementation of **Anyang Mahjong** (互报互飞, a local variant from Anyang, Henan, China). It can run as a Node + Socket.io multiplayer server, or as a pure static single-player page that pits you against 3 AIs.

**[Play online (solo build)](https://tiankai67.github.io/anyang-mahjong/)**

---

## 玩法规则 / Game Rules

安阳麻将与常见的国标/川麻差异很大，核心是**必须先"报听"才能胡牌**。

Anyang Mahjong differs greatly from the standard (GB) or Sichuan rules — the defining mechanic is that you **must declare "tenpai" (听) before you are allowed to win**.

| 项目 / Item | 规则 / Rule |
| --- | --- |
| 牌张 / Tiles | 万/条/筒各 36 张 + 风牌 16 张 + 箭牌 12 张 + **财神 1 张**，共 **137 张**<br>Wan/Tiao/Tong ×36 + Winds ×16 + Dragons ×12 + **1 Fortune tile** = **137** |
| 吃牌 / Chi | **不能吃**，只能碰和杠<br>**No chi** — only peng (碰) and gang (杠) |
| 报听 / Tenpai | 摸到能顶替手牌任意一张的牌（**顶张**）时，打出被顶替的牌并报听<br>When you draw a *replacement tile* that can substitute any tile in hand, discard the substituted one and declare tenpai |
| 胡牌 / Win | **只有报听后才能胡**，未报听不能胡<br>**Winning is only legal after tenpai** |
| 财神 / Fortune | 摸到财神即翻开补牌，持有财神者胡牌**翻倍**<br>Drawing the Fortune tile opens a replacement; holding it **doubles** the win score |
| 底分 / Base | 庄家 50 分，闲家 10 分<br>Dealer 50 pts, others 10 pts |
| 自摸 / Self-draw | 分数翻倍<br>Doubles the score |
| 牌型 / Patterns | 平胡 / 边张 / 卡张 / 单吊 / 七星对<br>Standard / Edge / Middle / Single-wait / Seven-pair |
| 杠分 / Gang | 明杠 1 嘴子，暗杠 2 嘴子（三家各付）<br>Open gang 1 unit, concealed gang 2 units (paid by the other three) |

嘴子（zuizi）即底分单位，可选 10 / 20 / 50 / 100。

*Zuizi* is the base-score unit; configurable as 10 / 20 / 50 / 100.

---

## 两种运行方式 / Two Ways to Run

### 1. 单机版（纯静态，零依赖）/ Solo build (static, zero-dependency)

`public/` 目录整个就是一个可独立运行的静态站点，内置完整的本地牌局引擎和 3 个 AI。

The `public/` folder is a fully self-contained static site with the complete local game engine and 3 AIs baked in.

```bash
# 任意静态服务器即可 / Any static server works
cd public && python -m http.server 8080
# 打开 http://localhost:8080 / open http://localhost:8080
```

也可以直接部署到 GitHub Pages / Vercel / Netlify / 对象存储，无需任何后端。

It can also be deployed directly to GitHub Pages / Vercel / Netlify / object storage with no backend.

### 2. 联机版（Node + Socket.io）/ Online build (Node + Socket.io)

```bash
npm install
npm start
# 打开 http://localhost:3000 / open http://localhost:3000
```

支持创建房间、房间号加入、房间列表、聊天、AI 补位、断线重连。

Supports room creation, join-by-code, room list, chat, AI fill-in, and reconnect.

### 3. 桌面无边框启动器（Electron）/ Desktop frameless launcher (Electron)

`launcher/` 是一个极简 Electron 外壳：启动 `server.js` 子进程，待就绪后以**无边框窗口**（无系统标题栏）打开 `http://localhost:3000`。适合打包成桌面 App 体验。

The `launcher/` is a minimal Electron shell: it spawns `server.js` as a child process and, once ready, opens `http://localhost:3000` in a **frameless window** (no system title bar) — handy as a packaged desktop app.

```bash
cd launcher && npm install   # 安装 Electron / install Electron
npm start                    # 启动器会自动拉起服务端 / launcher auto-starts the server
```

详见下方「桌面快捷方式」一节。See the *Desktop Shortcut* section below.

---

## 单机与联机是怎么共存的 / How Solo & Online Coexist

关键在 `public/js/solo.js` —— 一个**伪 socket 适配层**。

The trick is `public/js/solo.js` — a **fake socket adapter layer**.

```
                    ┌───────────────────────────┐
                    │        app.js (UI)        │
                    │  socket.on / socket.emit  │
                    └─────────────┬─────────────┘
                                  │  完全相同的事件协议 / identical event protocol
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
      ┌────────────────────┐            ┌────────────────────┐
      │  socket.io 客户端  │            │  solo.js 伪 socket │
      │   （联机模式）     │            │    （单机模式）    │
      └─────────┬──────────┘            └─────────┬──────────┘
                ▼                                 ▼
      ┌────────────────────┐            ┌────────────────────┐
      │ server.js 房间管理 │            │ engine.js 本地引擎 │
      │  src/roomManager   │            │  （同一套规则）    │
      └────────────────────┘            └────────────────────┘
```

`index.html` 里这一行是自动切换的开关：

The switch in `index.html` flips automatically:

```html
<script src="socket.io/socket.io.js" onerror="window.__NO_SERVER__=true"></script>
```

静态托管时该文件必然 404，`onerror` 触发后 `solo.js` 接管 `window.io`，
`app.js` 里的 `let socket = io()` 拿到的就是伪 socket —— **UI 代码一行都不用改**。

When served statically this file 404s, `onerror` fires, `solo.js` takes over `window.io`, and the `let socket = io()` in `app.js` gets the fake socket — **UI code stays untouched**.

也可以强制切换：给任意部署加 `?solo=1`。

You can also force solo mode with `?solo=1`.

---

## 项目结构 / Project Structure

```
anyang-mahjong/
├── server.js              # Express + Socket.io 服务端入口 / server entry
├── src/
│   ├── tiles.js           # 牌堆构造、洗牌、排序 / tile deck, shuffle, sort
│   ├── gameLogic.js       # 胡牌判定、听牌搜索、算分 / win/tenpai/score
│   ├── ai.js              # AI 出牌策略 / AI strategy
│   └── roomManager.js     # 房间状态机 / room state machine
├── public/                # 这一层可独立静态部署 / standalone deployable
│   ├── index.html
│   ├── css/style.css
│   ├── tiles/*.svg        # 麻将牌面 / tile faces
│   ├── voice/*.mp3        # 在线语音（报牌 + 动作）/ TTS voices
│   ├── music/*.mp3        # 背景音乐曲库 / BGM tracks
│   ├── sounds/*.wav       # 音效（发牌/碰/杠/胡等）/ SFX
│   ├── rules.html         # 完整规则说明页 / full rules page
│   └── js/
│       ├── app.js         # UI 渲染与交互（单机/联机共用）/ shared UI
│       ├── engine.js      # 浏览器内牌局引擎 / in-browser engine
│       └── solo.js        # 伪 socket 适配层 / fake socket adapter
├── launcher/              # Electron 桌面启动器 + 快捷方式生成 / desktop launcher
│   ├── main.js            # 拉起 server.js 并以无边框窗口打开 / boots server + frameless window
│   ├── make_shortcut.py   # 生成桌面 .lnk（Windows）/ desktop shortcut generator (Win)
│   ├── gen_icon.py/.js    # 生成发财图标 icon_facai.ico / icon generator
│   └── icon_facai.ico     # 桌面图标 / desktop icon
└── test-*.js              # 测试脚本 / test scripts
```

---

## 最近增强 / Recent Enhancements

> 以下能力已在 `29c28e5` 提交中随仓库发布。
> The features below shipped with commit `29c28e5`.

### 在线语音报牌 / Online TTS tile announcements
用 Edge TTS 预生成 **4 套音色**（女 / 男 / 女 / 童声）+ 35 个牌名，共 140 个 `public/voice/s{座位}_{牌名}.mp3`。
对局中轮到谁摸/打牌，就用**对应座位**的音色播报牌名（中/发/白读作红中/发财/白板）。缺失时自动回退浏览器 Web Speech。

Pre-generated with Edge TTS: **4 voices** (female / male / female / child) × 35 tile names = 140 MP3s in `public/voice/`. The tile name is spoken in the **seat's** voice when that seat draws/discards (中/发/白 → 红中/发财/白板). Falls back to browser Web Speech if a file is missing.

### 背景音乐曲库 / Background music library
3 首 BGM（`public/music/bgm_user.mp3`、`bgm_v1.mp3`、`bgm_v2.mp3`，由微信视频提取）。每次开局**随机从曲目 1/2/3 起播**；支持「顺序循环」与「单曲循环」双模式，可手动 ⏮ / ⏭ 切歌。

Three BGM tracks (extracted from WeChat videos). Each game starts from a **random track (1/2/3)**; supports *sequential loop* and *single loop* modes with manual ⏮ / ⏭ switching.

### 开局流程：先掷骰定庄 → 再发牌 → 再开始 / Opening flow: dice → deal → start
第 1 盘由玩家**点击实物骰子**掷骰定庄（真随机、按点数定庄家），骰子定格后服务端才真正发牌（带快速发牌动画），随后对局开始；第 2 盘起庄家顺延、不掷骰。

Round 1: the player **clicks the physical-looking dice** to roll and determine the dealer (true random, dealer by pip sum); only after the dice settle does the server deal (with a quick deal animation), then play begins. From round 2 the dealer rotates, no re-roll.

### 一局结束四家亮牌 / Reveal all four hands at round end
对局结束（胡牌 / 点炮 / 荒庄，含 AI 取胜）后，四家手牌**全部正面朝上**铺在桌面，胡牌的那张加金色高亮，财神(花牌)单独分组展示。

When a round ends (win / discard-win / draw, including AI wins), all four hands are **flipped face-up** on the table; the winning tile gets a golden highlight and Fortune (flower) tiles are grouped separately.

### 各角色动作语音 / Per-seat action voices
碰 / 暗杠 / 明杠 / 补杠 / 胡 / 自摸 / 报听，均按**出牌人座位**的音色朗读（28 个 `s{座位}_{动作}.mp3`），点缀以原有 CC0 音效。

Peng / concealed-gang / open-gang / added-gang / win / self-draw / tenpai are each spoken in the **actor's seat voice** (28 MP3s), layered over the original CC0 sound effects.

### 其它 / Misc
- 中心弃牌区改为 **8 列网格** + 细滚动条（去掉底部横向滚动条）。
  Center discard area is now an **8-column grid** with a slim scrollbar (no bottom horizontal bar).
- 结算框居中、半透明，亮牌清晰可见；顶部结算条作常驻摘要。
  The result modal is centered and semi-transparent so the revealed hands stay visible; a top result bar shows a persistent summary.
- 新增完整规则页 `public/rules.html`（入口在游戏内 📖 按钮）。
  A full rules page `public/rules.html` (opened via the in-game 📖 button).

---

## 桌面快捷方式 / Desktop Shortcut

> 说明：提交里随仓库发布的是**生成脚本与图标**（`launcher/make_shortcut.py`、`gen_icon.py/.js`、`icon_facai.ico`）。
> 而桌面上那个真正的「安阳麻将.lnk」位于你的 Desktop 目录，**不在 git 管理范围内**，因此不会被推送——它本就是脚本在用户机器上本地生成的。
>
> Note: what ships in the repo is the **generator scripts and icon** (`launcher/make_shortcut.py`, `gen_icon.py/.js`, `icon_facai.ico`). The actual "安阳麻将.lnk" on your Desktop lives **outside the repo**, so it is never committed — it is generated locally by the script on the user's machine.

### 重新生成桌面快捷方式 / Regenerate the desktop shortcut
在 Windows 上（需要 `pywin32`）：

On Windows (requires `pywin32`):

```bash
pip install pywin32
python launcher/make_shortcut.py
# 将在桌面创建「安阳麻将.lnk」，图标为发财牌、启动无边框桌面窗口
# creates "安阳麻将.lnk" on the Desktop, using the Fortune-tile icon, launching the frameless desktop window
```

> ⚠️ `make_shortcut.py` 当前写死了本机绝对路径（Electron 路径与图标路径）。换机器使用前请先改为你自己的安装路径，或改为相对路径后再运行。
> The script currently hardcodes this machine's absolute paths (Electron binary + icon). Edit them to your own install path (or make them relative) before running on another machine.

快捷方式指向 `launcher/main.js` 对应的 Electron 启动器，它会自动拉起 `server.js` 并以无边框窗口打开 `http://localhost:3000`。

The shortcut points at the Electron launcher (`launcher/main.js`), which auto-starts `server.js` and opens `http://localhost:3000` in a frameless window.

---

## 测试 / Tests

```bash
node test-engine.js 200    # 引擎算法 + 跑 200 局完整对局 / engine + 200 full games
node test-invariants.js    # 牌数守恒 / 手牌数不变量压测 / invariants stress test
node test-solo.js          # 单机适配层链路冒烟测试 / solo adapter smoke test
node test.js               # 基础规则单元测试 / basic rule unit tests
node test-ai.js            # AI 行为测试 / AI behavior tests

# 本轮新增的集成/界面回归测试 / new integration/DOM regression tests this round:
node test-dealflow.js     # 验证 先掷骰→再发牌→再开始 的事件顺序 / verifies dice→deal→start ordering
node test-reveal.js       # 验证 gameOver 推送四家亮牌数据 / verifies reveal data for all 4 seats
node test-reveal-dom.js   # 用 jsdom 实测 三家闲家从背面翻为正面 / jsdom test: 3 opponents flip back→face-up
```

`test-invariants.js` 会持续开局并在每次摸牌/打牌/碰杠后校验两条不变量：

`test-invariants.js` repeatedly starts games and checks two invariants after every draw/discard/peng/gang:

- 全局牌数恒为 137（任何区域都不许凭空多牌或丢牌）
  total tile count stays 137 (no tile may appear or vanish anywhere)
- 每家手牌数恒为 `13 - 3×(碰+杠)`，摸牌后 +1
  each hand size stays `13 - 3×(peng+gang)`, +1 after a draw

实测约 1200 局连续零违例。

Roughly 1200 consecutive games pass with zero violations.

---

## 牌面素材 / Tile Assets

麻将牌 SVG 来自 [lietxia/mahjong_graphic](https://github.com/lietxia/mahjong_graphic)。

Mahjong tile SVGs are from [lietxia/mahjong_graphic](https://github.com/lietxia/mahjong_graphic).

## 许可证 / License

MIT
