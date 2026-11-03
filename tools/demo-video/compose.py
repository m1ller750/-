import json, subprocess
TL = json.load(open('timeline.json')); XF = TL['xf']; scenes = TL['scenes']

def ts_ass(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"
def ts_srt(t):
    ms = int(round(t * 1000)); return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

cues = [{'text': c['text'], 'start': s['start'] + c['start'] - 0.05, 'end': s['start'] + c['end'] + 0.3} for s in scenes for c in s['cues']]
for a, b in zip(cues, cues[1:]):
    a['end'] = min(a['end'], b['start'] - 0.04)
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
       "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Sub,Inter SemiBold,44,&H00FFFFFF,&H00FFFFFF,&H30180C0B,&H00000000,0,0,0,0,100,100,0.2,0,3,15,0,2,230,230,30,1", "",
       "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
srt = []
for i, c in enumerate(cues, 1):
    ass.append(f"Dialogue: 0,{ts_ass(c['start'])},{ts_ass(c['end'])},Sub,,0,0,0,,{c['text']}")
    srt += [str(i), f"{ts_srt(c['start'])} --> {ts_srt(c['end'])}", c['text'], ""]
open('out/subs.ass', 'w').write('\n'.join(ass) + '\n')
open('out/TurniRUM-demo.srt', 'w').write('\n'.join(srt))

src = {'problem': 'mclips/problem.mp4', 'intro': 'mclips/intro.mp4', 'architecture': 'mclips/architecture.mp4', 'ai': 'mclips/ai.mp4',
       'benefits': 'mclips/benefits.mp4', 'outro': 'mclips/outro.mp4'}
inputs, chains = [], []
for i, s in enumerate(scenes):
    inputs += ['-i', src.get(s['id'], f"comp/{s['id']}.mp4")]
    chains.append(f"[{i}:v]fps=30,format=yuv420p,setsar=1,trim=duration={s['duration']:.3f},setpts=PTS-STARTPTS,settb=AVTB[v{i}]")
prev = 'v0'
for i in range(1, len(scenes)):
    out = f'x{i}'
    chains.append(f"[{prev}][v{i}]xfade=transition=fade:duration={XF}:offset={scenes[i]['start']:.3f}[{out}]")
    prev = out
chains.append(f"[{prev}]subtitles=out/subs.ass,format=yuv420p[vout]")
n = len(scenes)
inputs += ['-i', 'out/narration.wav', '-i', 'out/music.wav']
chains.append(f"[{n}:a]aformat=channel_layouts=stereo,volume=1.0[na]")
chains.append(f"[{n + 1}:a]aecho=0.8:0.6:90|170:0.22|0.12,volume=1.0[ma]")
chains.append("[na][ma]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]")
cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs, '-filter_complex', ';'.join(chains), '-map', '[vout]', '-map', '[aout]',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30',
       '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', f"{TL['total']:.3f}", 'out/TurniRUM-demo.mp4']
subprocess.run(cmd, check=True)
print('cues', len(cues))
