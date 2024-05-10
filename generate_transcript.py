import sys, json
from faster_whisper import WhisperModel, BatchedInferencePipeline

if sys.argv[1] is None or sys.argv[2] is None:
    sys.exit(0)

with open(sys.argv[1], "r", encoding="utf8") as file:
    audioFiles = json.load(file)
    model_size = "large-v3"

    # Run on GPU with FP16
    model = WhisperModel(model_size, device="cuda", compute_type="float16", download_root="H:/cache/whisper")
    model = BatchedInferencePipeline(model=model)
    transcriptions = []
    for audioFile in audioFiles:
        segmentsGen, info = model.transcribe(audioFile, word_timestamps=True, batch_size=8)
        segments = []
        for segment in segmentsGen:
            segments.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text,
                "words": [{"word": w.word, "start": w.start, "end": w.end, "probability": w.probability} for w in segment.words]
            })
        transcriptions.append(segments)
    with open(sys.argv[2], 'w') as f:
        json.dump(transcriptions, f)




