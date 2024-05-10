
from TTS.api import TTS
import torch
import sys, json
import subprocess
import os

if sys.argv[1] is None or sys.argv[3] is None:
    sys.exit(0)
    
with open(sys.argv[1], "r", encoding="utf-8") as file:
    audioInfos = json.load(file)
    device = torch.device(f"cuda:{sys.argv[3]}" if torch.cuda.is_available() else "cpu")
    tts = TTS("tts_models/en/multi-dataset/tortoise-v2").to(device)

    for audioInfo in audioInfos:
        speaker = os.path.basename(audioInfo["speakerVoiceFile"]).replace(".mp3", "").replace(".wav", "")
        speakersFolder = "./temp"
        speakerFolder = os.path.join(speakersFolder, speaker)
        
        if not os.path.exists(speakerFolder):
            os.makedirs(speakerFolder)
        
        if not os.path.exists(os.path.join(speakerFolder, 'speaker.wav')):
            subprocess.call(['ffmpeg', '-i', audioInfo["speakerVoiceFile"], "-y", os.path.join(speakerFolder, 'speaker.wav')])

        tts.tts_to_file(text=audioInfo["text"],
                    file_path=audioInfo["outputFile"],
                    voice_dir=speakersFolder,
                    speaker=speaker,
                    num_autoregressive_samples=1,
                    diffusion_iterations=10)


