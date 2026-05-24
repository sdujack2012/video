import sys, json, os

# Disable symlinks in huggingface_hub cache (requires Admin/Developer Mode on Windows)
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"

# Add CUDA 12 DLLs from nvidia pip packages to PATH so ctranslate2 can find cublas64_12.dll
_cuda_dll_dirs = [
    os.path.join(os.path.dirname(__file__), ".conda", "Lib", "site-packages", "nvidia", "cublas", "bin"),
    os.path.join(os.path.dirname(__file__), ".conda", "Lib", "site-packages", "nvidia", "cuda_runtime", "bin"),
    os.path.join(os.path.dirname(__file__), ".conda", "Lib", "site-packages", "nvidia", "cuda_nvrtc", "bin"),
]
for _d in _cuda_dll_dirs:
    if os.path.isdir(_d) and _d not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _d + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel, BatchedInferencePipeline

if sys.argv[1] is None or sys.argv[2] is None:
    sys.exit(0)

with open(sys.argv[1], "r", encoding="utf8") as file:
    audioFiles = json.load(file)
    model_size = "large-v3"

    # Run on GPU with FP16
    model = WhisperModel(model_size, device="cuda", compute_type="float16", download_root="F:/cache/whisper")
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




