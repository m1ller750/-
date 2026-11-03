# Demo video pipeline

How `docs/demo/TurniRUM-demo.mp4` (2:50, 1080p, English voice-over and subtitles) was made. Everything is scripted,
so the video can be rebuilt after the UI changes.

| Step | Script | What it does |
|------|--------|--------------|
| 1. Narration | `script.json` | The voice-over text, scene by scene |
| 2. Voice | `gen_tts.py`, `ttslib.py` | Gemini TTS, voice “Charon” (`gemini-3.8-flash-tts`; the last three scenes `gemini-2.5-flash-preview-tts`) |
| 3. Check | `verify_tts.py` | Gemini transcribes every take and compares it with the script word by word |
| 4. Timing | `align.py`, `timeline.py` | Finds where each sentence starts (pauses), trims silence, builds the timeline and the subtitle cues |
| 5. Screen scenes | `scenes.py`, `recorder.py`, `demo_env.py`, `web/` | Drives the real site with Playwright on the narration timeline and captures every repaint (Chrome screencast). The backend is `web/demo-api.js`, an in-memory copy of the site's API with one story (Valorant Night Cup); PayPal's buttons are stood in by `web/fake-paypal-demo.js` because the recorder has no internet |
| 6. Motion scenes | `motion/build.py`, `render_motion.py` | HTML/CSS animations rendered frame by frame at 30 fps |
| 7. Window frame | `make_frames.py`, `comp_screen.sh` | Puts the screen recordings into a browser window |
| 8. Sound | `audio.py` | Places the narration on the timeline, levels the scenes, adds a soft synthesized pad |
| 9. Final cut | `compose.py` | Crossfades, burned-in subtitles (`.ass`), loudness −16 LUFS, H.264 + AAC, `.srt` |

```bash
cd tools/demo-video
pip install playwright pillow numpy        # plus ffmpeg with libass
GEMINI_KEY=... python gen_tts.py && GEMINI_KEY=... python verify_tts.py
python align.py && python timeline.py
python make_bg.py && python scenes.py
python motion/build.py && python render_motion.py problem intro architecture ai benefits outro
python make_frames.py && for s in create pay bracket reschedule teammates results; do ./comp_screen.sh $s; done
python audio.py && python compose.py      # → out/TurniRUM-demo.mp4 and out/TurniRUM-demo.srt
```
