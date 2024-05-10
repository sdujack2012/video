import whisper
import sys, json

if sys.argv[1] is None or sys.argv[2] is None:
    sys.exit(0)

with open(sys.argv[1], "r") as file:
    audioFiles = json.load(file)
    model = whisper.load_model("small")
    transcriptions = []
    for audioFile in audioFiles:
        result = model.transcribe(audioFile, word_timestamps=True)
        transcriptions.append(result["segments"])
        print(result)
    with open(sys.argv[2], 'w') as f:
        json.dump(transcriptions, f)




