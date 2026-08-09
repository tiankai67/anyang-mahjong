# 用 Edge TTS（微软免费在线语音）预生成安阳麻将四座位报牌语音
# 座位(0自己/东,1下家,2对家,3上家) -> 角色；运行时直接播放本地 MP3，零延迟、音色分明
import os, asyncio, edge_tts

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "voice")
os.makedirs(OUT, exist_ok=True)

# 35 个牌名（与 src/tiles.js 完全一致；文件名以此 key 命名）
NAMES = (
    [f"{n}万" for n in range(1, 10)]
    + [f"{n}条" for n in range(1, 10)]
    + [f"{n}筒" for n in range(1, 10)]
    + ["东风", "南风", "西风", "北风"]
    + ["中", "发", "白"]
    + ["财神"]
)

# 报牌发音覆盖：中/发/白 读成两字（红中/发财/白板），文件名仍用原 key
SPEAK_TEXT = {"中": "红中", "发": "发财", "白": "白板"}

# 动作词：每个角色（座位）碰 / 各种杠 / 胡 / 自摸 / 报听 都用自己的音色播报
# 文件名 s{座位}_{动作}.mp3，运行时由 speakTile(动作, 座位) 直接播放
ACTIONS = ["碰", "暗杠", "明杠", "补杠", "胡", "自摸", "听"]

# 四座位 -> 语音 + 角色；童声用男嗓 + 高音高模拟
SEATS = [
    ("zh-CN-XiaoxiaoNeural", {},            "女"),  # 0 自己
    ("zh-CN-YunxiNeural",    {},            "男"),  # 1 下家
    ("zh-CN-XiaoyiNeural",   {},            "女"),  # 2 对家
    ("zh-CN-YunjianNeural",  {"pitch": "+30Hz", "rate": "+15%"}, "童"),  # 3 上家（童声：男嗓 + 高音调）
]

sem = asyncio.Semaphore(8)

async def synth(seat, voice, opts, name):
    path = os.path.join(OUT, f"s{seat}_{name}.mp3")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return f"skip {os.path.basename(path)}"
    spoken = SPEAK_TEXT.get(name, name)  # 中/发/白 -> 红中/发财/白板
    async with sem:
        comm = edge_tts.Communicate(text=spoken, voice=voice, **opts)
        await comm.save(path)
    return f"ok   {os.path.basename(path)} ({spoken})"

async def main():
    tasks = []
    for seat, (voice, opts, role) in enumerate(SEATS):
        print(f"座位{seat} [{role}] -> {voice}  ({len(NAMES)} 个牌名 + {len(ACTIONS)} 个动作)")
        for name in NAMES:
            tasks.append(synth(seat, voice, opts, name))
        for name in ACTIONS:
            tasks.append(synth(seat, voice, opts, name))
    results = await asyncio.gather(*tasks, return_exceptions=True)
    oks = sum(1 for r in results if isinstance(r, str) and r.startswith("ok"))
    skips = sum(1 for r in results if isinstance(r, str) and r.startswith("skip"))
    errs = [r for r in results if isinstance(r, Exception)]
    print(f"完成: 新生成 {oks}, 跳过 {skips}, 错误 {len(errs)}")
    for e in errs[:10]:
        print("  ERR", e)

asyncio.run(main())
