1. This project require ML models located in E:\cache to work. To use it, set the following ENV
HF_HUB_CACHE="E:\cache\hf\models"
HF_TOKEN="xxx"
TTS_HOME="E:\cache"
HF_HOME="E:\cache\hf"
XDG_DATA_HOME="E:\cache"
conda env config vars set HF_HUB_CACHE="E:\cache\hf\models" HF_TOKEN="xxxx" TTS_HOME="E:\cache" HF_HOME="E:\cache\hf" XDG_DATA_HOME="E:\cache"

or run conda env create -f ./conda_backup/environment.yml to recover the envirment
2. This project also requires specific version of ffmpeg to work. The working version is located in ./backup/ffmpeg-N-107272-g03b2ed9a50-win64-gpl.zip

3. create compatible silence: ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 10 -q:a 9 -acodec pcm_s16le -f s16le -ac 1 -ar 16000 -y out.mp3