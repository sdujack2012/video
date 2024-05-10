from TTS.api import TTS
import torch
import sys, json

if sys.argv[1] is None or sys.argv[3] is None:
    sys.exit(0)
    
with open(sys.argv[1], "r", encoding="utf-8") as file:
    audioInfos = json.load(file)
    device = torch.device(f"cuda:{sys.argv[3]}" if torch.cuda.is_available() else "cpu")
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

    for audioInfo in audioInfos:
        tts.tts_to_file(text=audioInfo["text"],
                    file_path=audioInfo["outputFile"],
                    speaker_wav=audioInfo["speakerVoiceFile"],
                    enable_text_splitting=True,
                    language="en")


