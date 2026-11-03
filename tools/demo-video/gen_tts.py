import json, sys, time, re
from ttslib import tts, duration
import os
# The video used gemini-3.8-flash-tts for scenes 1-9; its free quota (10 a day) ran out, so the last three scenes were
# voiced with gemini-2.5-flash-preview-tts and the same voice: TTS_MODEL=gemini-2.5-flash-preview-tts python gen_tts.py ai benefits outro
VOICE, MODEL = 'Charon', os.environ.get('TTS_MODEL', 'gemini-3.8-flash-tts')
scenes = json.load(open('script.json'))
only = set(sys.argv[1:])
for i, sc in enumerate(scenes):
    if only and sc['id'] not in only:
        continue
    text = ' '.join(sc['sentences']).replace('TurniRUM', 'Turni-Room')
    words = len(text.split())
    for attempt in range(3):
        w = tts(text, voice=VOICE, model=MODEL, style=None)
        d = duration(w)
        rate = words / d
        ok = 2.2 <= rate <= 3.6
        print(f"{sc['id']:13s} {d:6.2f}s {words:3d} words {rate:4.2f} w/s {'OK' if ok else 'SUSPICIOUS'}", flush=True)
        if ok:
            break
        time.sleep(8)
    open(f"tts/scene_{i:02d}_{sc['id']}.wav", 'wb').write(w)
    time.sleep(7)
