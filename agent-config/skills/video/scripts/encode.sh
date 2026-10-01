#!/bin/sh
# encode.sh FRAMES_DIR FIRST_FRAME OUT.mp4   (60 fps, H.264 high, yuv420p)
ffmpeg -y -loglevel error -framerate 60 -start_number "$2" -i "$1/%05d.jpg" -c:v libx264 -preset slow -crf 15 -profile:v high -pix_fmt yuv420p -movflags +faststart "$3"
