import json, re, subprocess
XF = 0.4  # crossfade between scenes
CFG = {  # pre-roll, post-roll, extra pause before sentence k
  'problem': (1.0, 0.5, {}), 'intro': (0.7, 0.5, {}), 'architecture': (0.5, 0.7, {}),
  'create': (0.9, 1.0, {2: 0.6, 3: 0.5}), 'pay': (0.7, 1.0, {1: 0.5, 2: 0.3}), 'bracket': (0.7, 0.8, {1: 0.4}),
  'reschedule': (0.6, 0.8, {}), 'teammates': (0.5, 1.3, {}), 'results': (0.6, 1.0, {1: 0.5, 2: 0.6}),
  'ai': (0.6, 0.7, {}), 'benefits': (0.6, 0.7, {}), 'outro': (0.4, 2.8, {}),
}
align = json.load(open('align.json'))

WEAK = {'the', 'a', 'an', 'and', 'for', 'by', 'of', 'to', 'with', 'where', 'from', 'in', 'on', 'or'}

def chunks(text, limit=80):
    """Splits a long sentence into 2-3 readable cues, preferring punctuation and never ending on a weak word."""
    if len(text) <= limit: return [text]
    n = 2 if len(text) <= 2 * limit - 6 else 3
    words = text.split(); best = None
    import itertools
    cuts = range(1, len(words))
    for combo in itertools.combinations(cuts, n - 1):
        parts = [' '.join(words[a:b]) for a, b in zip((0,) + combo, combo + (len(words),))]
        if max(len(x) for x in parts) > limit + 4: continue
        score = 0.0
        for x in parts[:-1]:
            last = x.split()[-1]
            score += -30 if last[-1] in ',:;' else (25 if last.lower() in WEAK else 0)
        score += (max(len(x) for x in parts) - min(len(x) for x in parts)) * 0.35
        if best is None or score < best[0]: best = (score, parts)
    return best[1]

def syllables(word):
    import re as _re
    return max(1, len(_re.findall(r'[aeiouy]+', word.lower().rstrip('e'))))

scenes, t = [], 0.0
for a in align:
    pre, post, extra = CFG[a['id']]
    sents, shift, out = a['sentences'], pre, []
    pieces = []  # audio pieces: (src_start, src_end, place_at)
    for k, s in enumerate(sents):
        if k in extra: shift += extra[k]
        out.append({'text': s['text'], 'start': round(s['start'] + shift, 3), 'end': round(s['end'] + shift, 3), 'src_start': s['start'], 'src_end': s['end']})
    # audio segments split at boundary midpoints so pauses can be inserted between sentences
    cuts = [0.0] + [round((sents[k - 1]['end'] + sents[k]['start']) / 2, 3) for k in range(1, len(sents))] + [a['duration']]
    shift = pre
    for k in range(len(sents)):
        if k in extra: shift += extra[k]
        pieces.append({'from': cuts[k], 'to': cuts[k + 1], 'at': round(cuts[k] + shift, 3)})
    dur = round(pre + a['duration'] + sum(extra.values()) + post, 3)
    cues = []
    for s in out:
        parts = chunks(s['text'])
        if len(parts) == 1:
            cues.append({'text': s['text'], 'start': s['start'], 'end': s['end']}); continue
        times = [s['start']]
        inner = [pp for pp in a['pauses'] if s['src_start'] + 0.05 < pp[0] and pp[1] < s['src_end'] - 0.05]
        marks = [w for w in s['text'].split()[:-1] if w[-1] in ',:;']
        sw = [syllables(w) for w in s['text'].split()]
        done_words = 0
        for p in parts[:-1]:
            done_words += len(p.split())
            k = sum(1 for w in p.split() if w[-1] in ',:;')
            if parts and p.split()[-1][-1] in ',:;' and len(inner) == len(marks) and k >= 1:
                src_t = inner[k - 1][1] - 0.04
            else:
                ideal = s['src_start'] + (s['src_end'] - s['src_start']) * sum(sw[:done_words]) / sum(sw)
                near = [pp[1] - 0.04 for pp in inner if abs((pp[0] + pp[1]) / 2 - ideal) < 0.7]
                src_t = min(near, key=lambda x: abs(x - ideal)) if near else ideal
            times.append(round(src_t - s['src_start'] + s['start'], 3))
        times.append(s['end'])
        for p, a0, b0 in zip(parts, times, times[1:]):
            cues.append({'text': p, 'start': a0, 'end': b0})
    scenes.append({'id': a['id'], 'kind': a['kind'], 'audio': a['audio'], 'start': round(t, 3), 'duration': dur, 'pre': pre,
                   'sentences': [{k: v for k, v in s.items() if not k.startswith('src_')} for s in out], 'pieces': pieces, 'cues': cues})
    t += dur - XF
total = round(t + XF, 3)
json.dump({'xf': XF, 'total': total, 'scenes': scenes}, open('timeline.json', 'w'), indent=1)
for s in scenes:
    print(f"{s['id']:13s} start {s['start']:7.2f}  dur {s['duration']:6.2f}  sentences at " + ', '.join(f"{x['start']:.2f}" for x in s['sentences']))
print('TOTAL', total, 'sec =', f"{int(total // 60)}:{total % 60:05.2f}")
print(max(len(c['text']) for s in scenes for c in s['cues']), 'max cue chars;', sum(len(s['cues']) for s in scenes), 'cues')
