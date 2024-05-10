import whisper
import sys, json

if sys.argv[1] is None or sys.argv[2] is None:
    sys.exit(0)

model = whisper.load_model("large", download_root="H:/cache/whisper").to("cuda")
transcriptions = []

# load audio and pad/trim it to fit 30 seconds
audio = whisper.load_audio(sys.argv[1])
audio = whisper.pad_or_trim(audio)

# make log-Mel spectrogram and move to the same device as the model
mel = whisper.log_mel_spectrogram(audio).to(model.device)

# detect the spoken language
_, probs = model.detect_language(mel)
print(f"Detected language: {max(probs, key=probs.get)}")

# decode the audio
options = whisper.DecodingOptions()
result = whisper.decode(model, mel, options)


result = model.transcribe(sys.argv[1])
with open(sys.argv[2], 'w') as f:
    json.dump(result["text"], f)




