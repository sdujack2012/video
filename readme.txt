1. This project require ML models located in F:\cache to work. To use it, set the following ENV
HF_HUB_CACHE="F:\cache\hf\models"
HF_TOKEN="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"
TTS_HOME="F:\cache"
HF_HOME="F:\cache\hf"
XDG_DATA_HOME="F:\cache"
2. This project also requires specific version of ffmpeg to work. The working version is located in ./backup/ffmpeg-N-107272-g03b2ed9a50-win64-gpl.zip

3. create compatible silence: ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 10 -q:a 9 -acodec pcm_s16le -f s16le -ac 1 -ar 16000 -y out.mp3

