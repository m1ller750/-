import json, wave, numpy as np
SR = 48000
TL = json.load(open('timeline.json'))
total = TL['total'] + 0.3
N = int(total * SR)

def load(p):
    with wave.open(p) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768

def active_rms(x):
    f = 1024; frames = x[: len(x) // f * f].reshape(-1, f); r = np.sqrt((frames ** 2).mean(1))
    return np.sqrt(np.mean(r[r > 0.02] ** 2))

narr = np.zeros(N)
target = 10 ** (-20 / 20)
for s in TL['scenes']:
    x = load(s['audio']); g = target / active_rms(x)
    for pc in s['pieces']:
        a, b = int(pc['from'] * SR), int(pc['to'] * SR); seg = x[a:b] * g
        fade = int(0.008 * SR); ramp = np.linspace(0, 1, fade)
        seg[:fade] *= ramp; seg[-fade:] *= ramp[::-1]
        at = int((s['start'] + pc['at']) * SR)
        narr[at: at + len(seg)] += seg
    print(f"{s['id']:13s} gain {20 * np.log10(g):+5.1f} dB")

# --- music bed: slow warm pad (A minor 9 → F maj7 → C maj7 → G6), sine partials with smooth envelopes ---
def hz(n):  # MIDI → Hz
    return 440 * 2 ** ((n - 69) / 12)
chords = [[45, 52, 55, 59, 60, 64], [41, 48, 52, 57, 60, 64], [48, 55, 59, 62, 64, 67], [43, 50, 55, 59, 62, 64]]
bar = 60 / 72 * 8  # 8 beats at 72 bpm
t = np.arange(N) / SR
music = np.zeros((N, 2))
k = 0; start = 0.0
while start < total:
    notes = chords[k % 4]
    a, b = int(start * SR), min(N, int((start + bar + 2.5) * SR))
    tt = t[a:b] - start
    env = np.minimum(1, tt / 1.6) * np.clip((bar + 2.5 - tt) / 2.5, 0, 1)
    env = np.clip(env, 0, 1) ** 1.5
    for i, n in enumerate(notes):
        f = hz(n + 12 if n < 50 and i > 0 else n)
        amp = (0.9 if i == 0 else 0.55) / (1 + 0.25 * i)
        for ch, det in ((0, -0.0012), (1, 0.0012)):
            ff = f * (1 + det * (1 if i % 2 else -1))
            ph = 2 * np.pi * ff * tt + i * 1.3 + ch * 0.7
            tone = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)
            music[a:b, ch] += amp * env * tone * (1 + 0.15 * np.sin(2 * np.pi * 0.11 * tt + i))
    # soft high shimmer on the 3rd and 5th notes
    for n in notes[2::2]:
        f = hz(n + 24)
        music[a:b, 0] += 0.05 * env * np.sin(2 * np.pi * f * tt)
        music[a:b, 1] += 0.05 * env * np.sin(2 * np.pi * f * 1.001 * tt + 1)
    start += bar; k += 1
# gentle one-pole low-pass and level
alpha = np.exp(-2 * np.pi * 2200 / SR)
for ch in range(2):
    y = music[:, ch]; out = np.empty_like(y); acc = 0.0
    # vectorized IIR via scipy is unavailable; use chunked loop with numpy cumulative trick
    out = np.zeros_like(y)
    prev = 0.0
    for i0 in range(0, len(y), SR):
        seg = y[i0:i0 + SR]
        r = np.empty_like(seg)
        for j in range(len(seg)):
            prev = (1 - alpha) * seg[j] + alpha * prev; r[j] = prev
        out[i0:i0 + SR] = r
    music[:, ch] = out
fade_in, fade_out = int(1.5 * SR), int(3.0 * SR)
music[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
music[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
music *= 10 ** (-38 / 20) / np.sqrt(np.mean(music ** 2))

def write(path, x):
    x = np.clip(x, -1, 1); ch = 1 if x.ndim == 1 else x.shape[1]
    with wave.open(path, 'wb') as w:
        w.setnchannels(ch); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype(np.int16).tobytes())
write('out/narration.wav', narr)
write('out/music.wav', music)
print('narration peak', round(20 * np.log10(np.abs(narr).max()), 1), 'dBFS; music rms -38 dBFS; length', round(total, 2), 's')
