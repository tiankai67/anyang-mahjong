#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成安阳麻将背景音乐（原创、可商用、无需署名）。
风格：C 大调五声音阶（宫调式）的舒缓国风小品，含：
  - 古筝/吉他风拨弦主旋律（Karplus-Strong 物理建模）
  - 柔和铺底和声（pad，正弦叠加 + 慢起音）
  - 低音拨弦（bass）
  - 轻量混响（反馈延迟 + 低通，营造空间感）
  - 合理节奏与乐句，结尾回到主音，循环无缝（首尾淡入淡出）

输出 public/music/track1~3.wav（无缝循环，单声道）。
可在本文件顶部改 BPM / 调式 / 时长 / 乐器亮度。
"""
import math
import os
import random
import struct
import wave

SR = 22050

# ---------------- 音名 -> 频率 ----------------
NOTE_BASE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
             'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}

def note_freq(name):
    letter = name[0]
    sharp = (len(name) > 1 and name[1] == '#')
    octv = int(name[-1])
    semi = NOTE_BASE[letter] + (1 if sharp else 0)
    midi = (octv + 1) * 12 + semi
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

# ---------------- 乐器合成 ----------------
def ks_pluck(freq, dur, vol=0.5, decay=2.2, bright=0.5):
    """Karplus-Strong 拨弦：古筝/琵琶质感，比纯正弦更自然。"""
    n = int(dur * SR)
    N = max(2, int(SR / freq))
    buf = [random.uniform(-1.0, 1.0) for _ in range(N)]
    out = [0.0] * n
    idx = 0
    # 初始低通让起音更柔和（模拟拨弦的“噗”声）
    for i in range(n):
        cur = buf[idx]
        nxt = buf[(idx + 1) % N]
        avg = (cur + nxt) * 0.5
        # 衰减系数与亮度相关：bright 越大衰减越慢、越亮
        g = 0.996 - (1.0 - bright) * 0.02
        out[i] = cur * vol
        buf[idx] = avg * g
        idx = (idx + 1) % N
    return out

def sine_pad(freq, dur, vol=0.18, atk=0.4, rel=0.6):
    """柔和铺底：正弦 + 少量泛音，慢起音慢收尾。"""
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        # 慢起慢落包络
        if t < atk:
            env = t / atk
        elif t > dur - rel:
            env = max(0.0, (dur - t) / rel)
        else:
            env = 1.0
        s = math.sin(2 * math.pi * freq * t)
        s += 0.25 * math.sin(2 * math.pi * 2 * freq * t)
        out[i] = s * env * vol
    return out

def bass_pluck(freq, dur, vol=0.32, decay=3.0):
    n = int(dur * SR)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        env = math.exp(-decay * t)
        s = math.sin(2 * math.pi * freq * t)
        s += 0.2 * math.sin(2 * math.pi * 2 * freq * t)
        atk = min(1.0, t / 0.004)
        out[i] = s * env * atk * vol
    return out

def mix_add(a, b, offset=0):
    """把 b 叠加到 a（从 offset 样本起），自动扩长 a。"""
    need = offset + len(b)
    if len(a) < need:
        a.extend([0.0] * (need - len(a)))
    for i, v in enumerate(b):
        a[offset + i] += v

# ---------------- 轻量混响（反馈延迟 + 低通）----------------
def simple_reverb(x, fb=0.32, delay=0.028, cutoff=0.45, wet=0.28):
    """单条反馈梳状延迟 + 一阶低通，营造房间感。O(n) 快速。"""
    out = [0.0] * len(x)
    D = max(1, int(delay * SR))
    buf = [0.0] * D
    bi = 0
    lp = 0.0
    for i, v in enumerate(x):
        d = buf[bi]
        lp += (d - lp) * cutoff          # 一阶低通
        buf[bi] = v + fb * lp
        bi = (bi + 1) % D
        out[i] = v + wet * lp
    return out

# ---------------- 作曲 ----------------
def build_track(seed, bpm=72, bars=8):
    random.seed(seed)
    beat = 60.0 / bpm
    slot = beat / 2.0          # 八分音符网格
    total_slots = bars * 4 * 2  # 每小节4拍，每拍2个八分

    # C 大调五声音阶：C D E G A（跨两个八度）
    scale = ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5', 'G5', 'A5', 'C6']
    scale_f = [note_freq(s) for s in scale]

    # 和声进行（每两小节一个）：C - Am - F - G（I-vi-IV-V），温柔且“中国风”相容
    chord_roots = ['C3', 'A2', 'F2', 'G2']          # bass 根音
    chord_tones = [                                  # pad 三和弦（取五声音阶内音）
        ['C4', 'E4', 'G4'],
        ['A3', 'C4', 'E4'],
        ['F3', 'A3', 'C4'],
        ['G3', 'B3', 'D4'],
    ]

    out = []  # 主旋律 + bass
    pad = []  # 铺底（最后混在一起）

    # 生成旋律：五声音阶上的随机游走，倾向级进，乐句尾落在主音
    melody = []
    cur = 5  # 从中央 C5 附近开始
    for s in range(total_slots):
        bar = s // 8
        beat_in_bar = (s // 2) % 4
        # 弱拍更可能休止，强拍必响，制造呼吸感
        if (s % 2 == 1) and random.random() < 0.45:
            melody.append(None)
            continue
        # 乐句最后一拍（每两小节末）强制回到主音，保证可循环
        if bar % 2 == 1 and beat_in_bar == 3 and (s % 2 == 0):
            cur = 5
            melody.append(scale[cur])
            continue
        # 级进为主，偶尔跳进
        step = random.choice([-1, -1, 0, 1, 1, 2, -2])
        cur = max(0, min(len(scale) - 1, cur + step))
        melody.append(scale[cur])

    # 渲染主旋律（拨弦）与 bass（每小节头）
    for s in range(total_slots):
        bar = s // 8
        chord_i = (bar // 2) % 4
        if s % 2 == 0:  # 每拍头：bass 根音
            bf = note_freq(chord_roots[chord_i])
            mix_add(out, bass_pluck(bf, beat * 0.9), int(s * slot * SR))
        m = melody[s]
        if m is not None:
            mf = note_freq(m)
            # 强拍稍响，弱拍稍弱
            vol = 0.5 if (s % 2 == 0) else 0.38
            mix_add(out, ks_pluck(mf, slot * 1.6, vol=vol, decay=2.4, bright=0.55),
                    int(s * slot * SR))

    # 渲染铺底和声（每两小节一长音）
    for bar in range(0, bars, 2):
        chord_i = (bar // 2) % 4
        start = int(bar * 4 * 2 * slot * SR)
        dur = 2 * 4 * slot  # 两小节
        for t in chord_tones[chord_i]:
            mix_add(pad, sine_pad(note_freq(t), dur, vol=0.14, atk=0.5, rel=0.8), start)

    # 合并：主旋律/bass 与 pad 对齐（pad 可能更长，补齐 out）
    if len(pad) > len(out):
        out.extend([0.0] * (len(pad) - len(out)))
    for i, v in enumerate(pad):
        out[i] += v

    # 混响
    out = simple_reverb(out)

    # 归一化 + 首尾淡入淡出（避免循环爆音）
    peak = max(1e-6, max(abs(v) for v in out))
    gain = 0.92 / peak
    fade = int(0.05 * SR)
    for i in range(len(out)):
        out[i] *= gain
        if i < fade:
            out[i] *= i / fade
        elif i > len(out) - fade:
            out[i] *= (len(out) - i) / fade
    return out

def write_wav(path, samples):
    with wave.open(path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for v in samples:
            v = max(-1.0, min(1.0, v))
            frames += struct.pack('<h', int(v * 32767))
        w.writeframes(bytes(frames))

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.normpath(os.path.join(here, '..', 'public', 'music'))
    os.makedirs(out_dir, exist_ok=True)
    # 三首：不同种子（旋律不同）但同风格，顺序轮换不单调
    for i, seed in enumerate([7, 21, 42], start=1):
        samples = build_track(seed=seed, bpm=72, bars=8)
        path = os.path.join(out_dir, f'track{i}.wav')
        write_wav(path, samples)
        dur = len(samples) / SR
        print(f'wrote {path}  ({dur:.1f}s, {len(samples)} samples)')

if __name__ == '__main__':
    main()
