import glob, json, re, subprocess, wave
scenes = json.load(open('script.json'))
PRE, POST = 0.06, 0.12

def silences(path, noise='-38dB', d=0.12):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', f'silencedetect=n={noise}:d={d}', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', out)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', out)]
    return list(zip(starts, ends + [None] * (len(starts) - len(ends))))

def dur(path):
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()

def choose(cands, expected):
    # DP: pick len(expected) ordered silences close to the expected boundaries, preferring longer pauses
    n, k = len(expected), len(cands)
    INF = 1e9
    cost = [[INF] * k for _ in range(n)]; back = [[-1] * k for _ in range(n)]
    c = lambda j, i: abs((cands[i][0] + cands[i][1]) / 2 - expected[j]) - 1.5 * (cands[i][1] - cands[i][0])
    for i in range(k): cost[0][i] = c(0, i)
    for j in range(1, n):
        for i in range(k):
            best = min(((cost[j - 1][p], p) for p in range(i)), default=(INF, -1))
            if best[0] < INF: cost[j][i], back[j][i] = best[0] + c(j, i), best[1]
    i = min(range(k), key=lambda x: cost[n - 1][x]); picks = []
    for j in range(n - 1, -1, -1):
        picks.append(cands[i]); i = back[j][i]
    return picks[::-1]

result = []
for idx, sc in enumerate(scenes):
    path = glob.glob(f'tts/scene_{idx:02d}_*.wav')[0]
    total = dur(path)
    sil = [(s, e if e is not None else total) for s, e in silences(path)]
    speech_start = sil[0][1] if sil and sil[0][0] < 0.02 else 0.0
    speech_end = sil[-1][0] if sil and sil[-1][1] >= total - 0.02 else total
    internal = [x for x in sil if x[0] > speech_start + 0.05 and x[1] < speech_end - 0.05]
    sents = sc['sentences']
    lens = [len(s) for s in sents]
    span = speech_end - speech_start
    expected = [speech_start + span * sum(lens[:j + 1]) / sum(lens) for j in range(len(sents) - 1)]
    bounds = choose(internal, expected) if len(sents) > 1 else []
    starts = [speech_start] + [b[1] for b in bounds]
    ends = [b[0] for b in bounds] + [speech_end]
    offset = speech_start - PRE
    out = {'id': sc['id'], 'kind': sc['kind'], 'src': path, 'trim_start': round(offset, 3), 'trim_end': round(speech_end + POST, 3),
           'duration': round(speech_end + POST - offset, 3),
           'sentences': [{'text': s, 'start': round(a - offset, 3), 'end': round(b - offset, 3)} for s, a, b in zip(sents, starts, ends)],
           'pauses': [[round(s - offset, 3), round(e - offset, 3)] for s, e in internal]}
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-ss', str(offset), '-to', str(speech_end + POST),
                    '-ar', '48000', '-ac', '1', f"trim/{idx:02d}_{sc['id']}.wav"], check=True)
    out['audio'] = f"trim/{idx:02d}_{sc['id']}.wav"
    result.append(out)
    print(f"{sc['id']:13s} {out['duration']:6.2f}s  " + '  '.join(f"[{x['start']:.2f}-{x['end']:.2f}]" for x in out['sentences']))
json.dump(result, open('align.json', 'w'), indent=1)
print('speech total', round(sum(x['duration'] for x in result), 2))
