# 安阳麻将 · Anyang Mahjong

河南安阳地方麻将（**互报互飞**）的网页实现。既能作为 Node 服务开房联机，也能作为纯静态页面单机对战 3 个 AI。

**[在线试玩（单机版）](https://tiankai67.github.io/anyang-mahjong/)**

---

## 玩法规则

安阳麻将与常见的国标/川麻差异很大，核心是**必须先"报听"才能胡牌**。

| 项目 | 规则 |
| --- | --- |
| 牌张 | 万/条/筒各 36 张 + 风牌 16 张 + 箭牌 12 张 + **财神 1 张**，共 **137 张** |
| 吃牌 | **不能吃**，只能碰和杠 |
| 报听 | 摸到能顶替手牌任意一张的牌（**顶张**）时，打出被顶替的牌并报听 |
| 胡牌 | **只有报听后才能胡**，未报听不能胡 |
| 财神 | 摸到财神即翻开补牌，持有财神者胡牌**翻倍** |
| 底分 | 庄家 50 分，闲家 10 分 |
| 自摸 | 分数翻倍 |
| 牌型 | 平胡 / 边张 / 卡张 / 单吊 / 七星对 |
| 杠分 | 明杠 1 嘴子，暗杠 2 嘴子（三家各付） |

嘴子（zuizi）即底分单位，可选 10 / 20 / 50 / 100。

---

## 两种运行方式

### 1. 单机版（纯静态，零依赖）

`public/` 目录整个就是一个可独立运行的静态站点，内置完整的本地牌局引擎和 3 个 AI。

```bash
# 任意静态服务器即可
cd public && python -m http.server 8080
# 打开 http://localhost:8080
```

也可以直接部署到 GitHub Pages / Vercel / Netlify / 对象存储，无需任何后端。

### 2. 联机版（Node + Socket.io）

```bash
npm install
npm start
# 打开 http://localhost:3000
```

支持创建房间、房间号加入、房间列表、聊天、AI 补位、断线重连。

---

## 单机与联机是怎么共存的

关键在 `public/js/solo.js` —— 一个**伪 socket 适配层**。

```
                    ┌───────────────────────────┐
                    │        app.js (UI)        │
                    │  socket.on / socket.emit  │
                    └─────────────┬─────────────┘
                                  │  完全相同的事件协议
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

```html
<script src="socket.io/socket.io.js" onerror="window.__NO_SERVER__=true"></script>
```

静态托管时该文件必然 404，`onerror` 触发后 `solo.js` 接管 `window.io`，
`app.js` 里的 `let socket = io()` 拿到的就是伪 socket —— **UI 代码一行都不用改**。

也可以强制切换：给任意部署加 `?solo=1`。

---

## 项目结构

```
anyang-mahjong/
├── server.js              # Express + Socket.io 服务端入口
├── src/
│   ├── tiles.js           # 牌堆构造、洗牌、排序
│   ├── gameLogic.js       # 胡牌判定、听牌搜索、算分
│   ├── ai.js              # AI 出牌策略
│   └── roomManager.js     # 房间状态机
├── public/                # 这一层可独立静态部署
│   ├── index.html
│   ├── css/style.css
│   ├── tiles/*.svg        # 麻将牌面
│   └── js/
│       ├── app.js         # UI 渲染与交互（单机/联机共用）
│       ├── engine.js      # 浏览器内牌局引擎（src/ 的完整移植）
│       └── solo.js        # 伪 socket 适配层
└── test-*.js              # 测试脚本
```

---

## 测试

```bash
node test-engine.js 200    # 引擎算法 + 跑 200 局完整对局
node test-invariants.js    # 牌数守恒 / 手牌数不变量压测
node test-solo.js          # 单机适配层链路冒烟测试
node test.js               # 基础规则单元测试
node test-ai.js            # AI 行为测试
```

`test-invariants.js` 会持续开局并在每次摸牌/打牌/碰杠后校验两条不变量：

- 全局牌数恒为 137（任何区域都不许凭空多牌或丢牌）
- 每家手牌数恒为 `13 - 3×(碰+杠)`，摸牌后 +1

实测约 1200 局连续零违例。

---

## 牌面素材

麻将牌 SVG 来自 [lietxia/mahjong_graphic](https://github.com/lietxia/mahjong_graphic)。

## 许可证

MIT
