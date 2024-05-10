from TTS.api import TTS
import sys, json

if sys.argv[1] is None:
    sys.exit(0)
with open(sys.argv[1], "r") as file:
    audioInfos = json.load(file)

    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")

    for script, outputFile, speakerVoiceFile in zip(audioInfos["scripts"],audioInfos["outputFiles"], audioInfos["speakerVoiceFiles"]):
        print(script)
        tts.tts_to_file(text=script,
                    file_path=outputFile,
                    speaker_wav=speakerVoiceFile if speakerVoiceFile is not None else "./speakers/woman 2.mp3",
                    language="en")


