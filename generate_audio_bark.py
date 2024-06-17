from TTS.api import TTS
import sys, json

if sys.argv[1] is None:
    sys.exit(0)
with open(sys.argv[1], "r", encoding="utf-8") as file:
    audioInfos = json.load(file)

    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")

    for audioInfo in audioInfos:
        tts.tts_to_file(text=audioInfo["text"],
                    file_path=audioInfo["outputFile"],
                    speaker_wav=audioInfo["speakerVoiceFile"],
                    language="en")


