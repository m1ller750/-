#!/bin/bash
# composite one screen recording into the window frame: $1 = scene id
set -e
cd "$(dirname "$0")"
DUR=$(python3 -c "import json;print(json.load(open('rec/$1/frames.json'))['duration'])")
ffmpeg -hide_banner -loglevel error -y -i rec/$1/clip.mp4 -loop 1 -framerate 30 -i comp/frame_$1.png -filter_complex \
 "color=c=black:s=1920x1080:r=30:d=$DUR[base];[0:v]fps=30,setpts=PTS-STARTPTS[c];[base][c]overlay=192:86:eof_action=repeat[b];[b][1:v]overlay=0:0:shortest=1,format=yuv420p" \
 -t $DUR -r 30 -c:v libx264 -preset medium -crf 14 comp/$1.mp4
echo "comp/$1.mp4 $DUR"
