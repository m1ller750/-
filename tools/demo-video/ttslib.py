import base64, json, os, struct, time, urllib.request, urllib.error, wave, io
KEY = os.environ['GEMINI_KEY']
STYLE = ("Read the following narration as the voice-over of a polished product demo video. "
         "Sound like a friendly, confident tech presenter talking to one person: warm, natural and conversational, "
         "with a lively but unhurried pace and natural pauses between sentences.")

def tts(text, voice='Charon', model='gemini-3.8-flash-tts', style=STYLE, retries=4):
    prompt = f"{style}\n\n{text}" if style else text
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                         data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            part = data["candidates"][0]["content"]["parts"][0]["inlineData"]
            raw = base64.b64decode(part["data"])
            mime = part.get("mimeType", "")
            return to_wav(raw, mime)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:200]!r}"
        except Exception as e:  # noqa
            last = repr(e)
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(last)

def to_wav(raw, mime):
    if raw[:4] == b'RIFF':
        return raw
    rate = 24000
    for piece in mime.split(';'):
        piece = piece.strip()
        if piece.startswith('rate='):
            rate = int(piece[5:])
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        # L16 is big-endian PCM per RFC 2586; Gemini returns little-endian despite the name, so keep bytes as is
        w.writeframes(raw)
    return buf.getvalue()

def duration(wav_bytes):
    with wave.open(io.BytesIO(wav_bytes)) as w:
        return w.getnframes() / w.getframerate()

def transcribe(path, question, model='gemini-3.5-flash'):
    audio = base64.b64encode(open(path, 'rb').read()).decode()
    body = {"contents": [{"parts": [{"inlineData": {"mimeType": "audio/wav", "data": audio}}, {"text": question}]}]}
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                         data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"] if not p.get("thought"))
        except Exception as e:  # noqa
            last = repr(e); time.sleep(3)
    return f"ERROR {last}"
