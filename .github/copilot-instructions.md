# AI Story Video Generator - Copilot Instructions

## Project Overview
This is an automated story-to-video generation pipeline that converts narrative text into professionally rendered videos with AI-generated images/videos, voice narration, subtitles, and background music. The system orchestrates multiple ML models through ComfyUI and Python scripts.

## Architecture

### Core Pipeline (create_stories.js)
Entry point: `node create_stories.js "Story Title"`
- Reads story definitions from `stories.json`
- Creates output structure in `videos/<title>/`
- Orchestrates: resource generation → video rendering
- Skips videos that already exist (checks `story.videoFilePath`)

### Hybrid JavaScript/Python Stack
**JavaScript (Node.js)**: Orchestration, ComfyUI client, video assembly with FFmpeg
**Python**: ML model execution (TTS, image/video generation, transcription)

Communication via `executeExternalHelper()` pattern:
- JS writes JSON to `temp/temp_<random>.json`
- Spawns Python with input/output file paths
- Python reads input, executes, writes output JSON
- JS reads result and cleans up temp files

## Critical Dependencies

### Environment Setup (See readme.txt)
**Use Conda for Python environment management**:
```bash
# Create environment from backup:
conda env create -f ./conda_backup/environment.yml

# Required environment variables for ML model cache:
conda env config vars set HF_HUB_CACHE="E:\cache\hf\models" HF_TOKEN="<your_token>" TTS_HOME="E:\cache" HF_HOME="E:\cache\hf" XDG_DATA_HOME="E:\cache"
```

### FFmpeg Version Lock
**Critical**: Use bundled FFmpeg from `backup/ffmpeg-N-107272-g03b2ed9a50-win64-gpl.zip`
- Newer versions break complex filter chains in render_video.js
- Handles ASS subtitle rendering with proper backslash escaping on Windows

### ComfyUI Integration
Runs dual ComfyUI servers (127.0.0.1:8188 and :8189) for parallel GPU utilization
- Custom WebSocket client in `comfyui_client.js`
- Workflows stored in `comfyUI workflows/` (JSON format, ~30 files, some deprecated)
- Active workflows: `wan2.2_i2v.json` (image-to-video), `qwen3_vl.json` (vision-language), `free_memory.json` (VRAM cleanup)
- Memory management: `freeComfyUIMemory()` runs between tasks to prevent VRAM exhaustion

## Key Patterns

### Story Configuration (stories.json)
```javascript
{
  "title": "Story Title",
  "content": "Text with *** separators for scene breaks",
  "genre": "horror|mythology|kid",  // affects BGM/voice selection
  "style": "story telling|funny",
  "speakerFile": "./resources/speakers/...",  // override default narrator
  "enableVideo": true,  // false = static images only
  "skipTitle": true,  // skip title card rendering
  "coverOnly": true  // just title card, no content scenes
}
```

### GPU Orchestration with MobX
Uses `mobx` observables for concurrent task management:
```javascript
let gpus = observable([
  { limit: 3, current: 0 },  // GPU 0
  { limit: 3, current: 0 }   // GPU 1
]);
await when(() => gpus.some(gpu => gpu.limit > gpu.current));
```
This prevents VRAM exhaustion by limiting concurrent operations per GPU.

### Text Chunking Algorithm (generate_story_resources.js)
`splitLongTextIntoChunks()`:
- Handles both English (word count) and Chinese (character count) with `[\u4e00-\u9fa5]` regex
- Absolute separators: `***` (manual scene breaks)
- Relative separators: `\n`, `.`, `?`, `!`
- Normalizes Chinese punctuation to English equivalents before splitting
- Merges chunks to stay under token limit (~30 tokens/40 chars)

### Voice Assignment Strategy
Gender-based voice pool allocation:
- Extracts characters with `extractCharactersFromStory()` using LLM
- Assigns from `./resources/speakers/` (17 male, 10 female voices)
- Falls back to narrator voice if character exceeds pool size
- Narrator selection: `story.speakerFile` > genre default > `matt.mp3`

### FFmpeg Subtitle Rendering (render_video.js)
Windows path escaping for ASS filter:
```javascript
const assFilterPath = tempAssLinkPath.replace(/\\/g, '\\\\\\\\');  // 4x backslash
await exec(`ffmpeg -i "${input}" -vf "ass='${assFilterPath}'" ...`);
```
ASS files generated with word-level timestamps from transcription.

### Configuration System (config.js)
Central config for all rendering parameters:
- `sizeMapping`: Image dimensions by video type
- `screenSizeMapping`: Final video canvas size
- `genreBGM`: Background music per genre
- `subtitleYs`: Vertical subtitle position (40 standard, 250 short)
- `clipGappingTime`: 0.3s gaps between scenes
- `transitionDuration`: 0.5s crossfade

## Workflow Commands

### Generate New Video
```bash
node create_stories.js "Your Story Title"
```
Runs full pipeline if video doesn't exist, resumes from last checkpoint if partial.

### Debug Individual Stages
In `create_stories.js`, uncomment lines to run specific steps:
```javascript
await generateStoryExtractInfo(story.title);  // Extract characters
await splitStoryIntoChunks(story.title);      // Text chunking
await generateStoryAudios(story.title);       // TTS generation
await generateTranscript(story.title);        // Word timestamps
await generateScenePrompts(story.title);      // Image prompts
await generateScenes(story.title);            // Image/video generation
await renderVideo(title);                     // Final assembly
```

### API Key Management
`apikey.json` contains provider credentials:
```json
{
  "openAI": "sk-...",
  "groq": "gsk_...",
  "ollama": "ollama",  // local, no key needed
  "lm": "lm"  // LM Studio, local
}
```
Used in `generateTextOpenAI()` for story analysis and prompt generation.

**Local Models** (Ollama):
- `llama3_custom` and `deepseek-r1:7b` run locally via Ollama
- Used for text generation tasks when not using cloud APIs
- Automatically free VRAM via `freeVRams()` when needed

## Common Gotchas

1. **ComfyUI Workflow Updates**: Workflow JSON files hardcode node IDs. When modifying workflows in ComfyUI, export and replace entire JSON file—don't manually edit node references.

2. **Audio Format Compatibility**: Python TTS outputs must match FFmpeg expectations. Use `anullsrc=channel_layout=stereo:sample_rate=44100` for silence padding (see readme.txt).

3. **Transcript Filtering**: First chunk transcripts need title duration filtering:
   ```javascript
   if (index === 0 && !story.skipTitle) {
     words = words.filter(word => word.end > story.titleAudioDuration + 0.2);
   }
   ```

4. **Temp File Cleanup**: `temp/` directory accumulates intermediate JSON files. Safe to delete when no processes running.

5. **Video Type Detection**: Automatically sets `story.videoType = "short"|"standard"` based on `totalDuration < 60` seconds. Affects subtitle sizing and positioning.

6. **Error Recovery**: No centralized error handling yet. The checkpoint system in `videos/<title>/story.json` tracks progress—if a run fails, re-running the same command resumes from last successful stage (checks for existing files).

## File Structure Semantics
```
videos/<title>/
  story.json          # Persistent state (checkpoints progress)
  images/             # Generated scenes (cover.png, scene1.png, ...)
  audios/             # TTS outputs (titleAudio.mp3, chunk 1.mp3, ...)
  videos/temp/        # Intermediate render files (temp_merged_video_*.mkv)
  <title>_final.mp4   # Final output (story.videoFilePath)
```

## AI Model Context

### Text Generation
- Llama-3-8B (local) via `generate_text.py` or Ollama
- Groq API for faster inference (configured in `apikey.json`)
- Qwen VLM for visual reasoning via ComfyUI workflow

### TTS
- XTTS v2 multi-speaker model (requires speaker reference files)
- GPU selection via `sys.argv[3]` in `generate_audio.py`

### Image/Video Generation
- ComfyUI workflows using various models (Flux, SDXL Lightning, Wan 2.2)
- Image-to-video pipelines for scene animation when `enableVideo: true`
- Prompt refinement: `batchRefineVideoPromptsOllama()` improves prompts before generation

## When Modifying Code

- **Adding genres**: Update `genreBGM`, `titleFontColors` in config.js + narrator defaults in generate_story_resources.js
- **New TTS models**: Modify `generate_audio.py` + update `batchGenerateAudios()` call pattern
- **Video effects**: Edit FFmpeg filter chains in render_video.js (test escaping on Windows!)
- **Parallel execution**: Adjust MobX GPU limits based on VRAM availability
