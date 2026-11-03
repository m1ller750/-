import json, re, difflib, glob, time
from ttslib import transcribe
scenes = json.load(open('script.json'))
norm = lambda s: re.sub(r'\s+', ' ', re.sub(r'[^a-z ]', ' ', s.lower().replace('turnirum', 'turniroom').replace('-', ' '))).strip()
for i, sc in enumerate(scenes):
    path = glob.glob(f'tts/scene_{i:02d}_*.wav')[0]
    want = ' '.join(sc['sentences'])
    got = transcribe(path, 'Transcribe this audio word for word, including every sentence from start to end. Output only the transcript.', model='gemini-3.5-flash-lite').strip()
    a, b = norm(want).split(), norm(got).split()
    sim = difflib.SequenceMatcher(None, a, b).ratio()
    extra = [b[j1:j2] for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes() if tag in ('insert', 'replace')]
    print(f"{sc['id']:13s} sim={sim:.2f} words want={len(a)} got={len(b)} diffs={extra[:4]}")
    time.sleep(1)
