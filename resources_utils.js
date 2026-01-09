const fs = require("fs");
const path = require("path");
const axios = require("axios");
const OpenAI = require("openai");
const { stringSimilarity } = require("string-similarity-js");
const {
  executeExternalHelper,
  splitArrayIntoChunks,
  createFolderIfNotExist,
  withComfyUIServers,
} = require("./utils");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const { when, runInAction } = require("mobx");

async function generateTextOpenAI(messages, provider, model) {
  if (provider === "ollama") {
    return await generateTextOllama(messages, model);
  } else {
    const apiKeys = JSON.parse(fs.readFileSync("./apikey.json", "utf8"));
    const baseURLs = {
      openAI: undefined,
      groq: "https://api.groq.com/openai/v1",
      hf: "https://rhlobdgx0viuipyy.us-east-1.aws.endpoints.huggingface.cloud/v1/",
      ollama: "http://localhost:11434/v1/",
      lm: "http://localhost:1234/v1/",
    };
    const apiKey = apiKeys[provider];
    const baseURL = baseURLs[provider];

    if (!apiKey || (!baseURL && provider !== "openAI")) {
      throw `Error: apiKey ${apiKey} or baseURL ${baseURL}`;
    }

    const openai = new OpenAI({
      apiKey,
      baseURL,
    });

    const res = await openai.chat.completions.create({
      messages,
      model,
    });
    return res.choices[0].message;
  }
}

async function batchGenerateAudiosComfyUI(audioDetails) {
  // Check if any audio files need to be generated
  const needsGeneration = audioDetails.some(detail => !fs.existsSync(detail.outputFile));

  if (!needsGeneration) {
    console.log('All audio files already exist, skipping ComfyUI server startup');
    return;
  }
  return await withComfyUIServers([8188, 8189], async (clients) => {

    const audioGenerates = [];

    const totalAudios = audioDetails.filter(detail => !fs.existsSync(detail.outputFile)).length;
    let completedAudios = 0;

    for (let audioDetail of audioDetails) {
      if (fs.existsSync(audioDetail.outputFile)) continue;
      await when(() => clients.some((clientConfig) => clientConfig.free));
      const availableClient = clients.findIndex(
        (clientConfig) => clientConfig.free
      );
      console.log("availableClient", availableClient);

      runInAction(() => {
        clients[availableClient].free = false;
      });

      const indexTTS2 = JSON.parse(
        fs.readFileSync("./comfyUI workflows/index_tts2-v2.json")
      );

      indexTTS2["47"]["inputs"]["seed"] = Math.floor(
        Math.random() * 4294967294
      );
      indexTTS2["65"]["inputs"]["value"] = audioDetail.text;
      indexTTS2["135"]["inputs"]["audio"] = audioDetail.speakerVoiceFile;
      indexTTS2["134"]["inputs"]["filename_prefix"] = "audio";


      const generateAudio = async () => {
        const outputfiles = await clients[availableClient].client.getOutputFiles(
          indexTTS2,
          "audio",
          "mp3"
        );
        const outputfile = outputfiles[0];
        const buffer = Buffer.from(await outputfile.blob.arrayBuffer());

        fs.writeFileSync(audioDetail.outputFile, buffer);

        completedAudios++;
        console.log(`Audio generation progress: ${completedAudios}/${totalAudios}`);

        runInAction(() => {
          clients[availableClient].free = true;
        });
      };
      audioGenerates.push(generateAudio());
    }

    await Promise.all(audioGenerates);
  });
}

async function batchGenerateVideosComfyUI(imagePromptDetails) {
  // Check if any video files need to be generated
  const needsGeneration = imagePromptDetails.some(detail => !fs.existsSync(detail.videoFile));

  if (!needsGeneration) {
    console.log('All video files already exist, skipping ComfyUI server startup');
    return;
  }
  return await withComfyUIServers([8188, 8189], async (clients) => {

    const imagesGenerates = [];

    const totalVideos = imagePromptDetails.filter(detail => !fs.existsSync(detail.videoFile)).length;
    let completedVideos = 0;

    for (let imagePromptDetail of imagePromptDetails) {
      if (fs.existsSync(imagePromptDetail.videoFile)) continue;
      await when(() => clients.some((clientConfig) => clientConfig.free));
      const availableClient = clients.findIndex(
        (clientConfig) => clientConfig.free
      );
      console.log("availableClient", availableClient);

      runInAction(() => {
        clients[availableClient].free = false;
      });
      // const workflow = JSON.parse(
      //   fs.readFileSync("./comfyUI workflows/wan2.2_t2v.json")
      // );

      // workflow["81"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
      // workflow["89"]["inputs"]["text"] =
      //   imagePromptDetail.style +
      //   ", " +
      //   imagePromptDetail.prompt;
      // workflow["74"]["inputs"]["width"] = imagePromptDetail.width / 2;
      // workflow["74"]["inputs"]["height"] = imagePromptDetail.height / 2;
      // workflow["80"]["inputs"]["filename_prefix"] = "video";
      const workflow = JSON.parse(
        fs.readFileSync("./comfyUI workflows/ltx2_i2v.json")
      );

      workflow["118"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
      workflow["120"]["inputs"]["text"] = JSON.stringify(imagePromptDetail.refinedVideoPrompt || imagePromptDetail.videoPrompt);
      workflow["102"]["inputs"]["resize_type.width"] = imagePromptDetail.width;
      workflow["102"]["inputs"]["resize_type.height"] = imagePromptDetail.height;
      workflow["98"]["inputs"]["image"] = imagePromptDetail.imageFile;
      workflow["146"]["inputs"]["filename_prefix"] = "video";

      const generateImage = async () => {
        const outputfiles = await clients[availableClient].client.getOutputFiles(
          workflow,
          "video",
          "mp4"
        );
        const outputfile = outputfiles[0];
        const buffer = Buffer.from(await outputfile.blob.arrayBuffer());

        fs.writeFileSync(imagePromptDetail.videoFile, buffer);

        completedVideos++;
        console.log(`Video generation progress: ${completedVideos}/${totalVideos}`);

        runInAction(() => {
          clients[availableClient].free = true;
        });
      };
      imagesGenerates.push(generateImage());
    }

    await Promise.all(imagesGenerates);
  });
}

async function batchGenerateImagesComfyUI(imagePromptDetails) {
  // Check if any image files need to be generated
  const needsGeneration = imagePromptDetails.some(detail => !fs.existsSync(detail.imageFile));

  if (!needsGeneration) {
    console.log('All image files already exist, skipping ComfyUI server startup');
    return;
  }
  return await withComfyUIServers([8188, 8189], async (clients) => {

    const imagesGenerates = [];

    const totalImages = imagePromptDetails.filter(detail => !fs.existsSync(detail.imageFile)).length;
    let completedImages = 0;

    for (let imagePromptDetail of imagePromptDetails) {
      if (fs.existsSync(imagePromptDetail.imageFile)) continue;
      await when(() => clients.some((clientConfig) => clientConfig.free));
      const availableClient = clients.findIndex(
        (clientConfig) => clientConfig.free
      );
      console.log("availableClient", availableClient);

      runInAction(() => {
        clients[availableClient].free = false;
      });

      const workflow = JSON.parse(
        fs.readFileSync("./comfyUI workflows/z_image_turbo.json")
      );

      workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
      workflow["6"]["inputs"]["text"] =
        imagePromptDetail.style +
        ", " +
        imagePromptDetail.prompt;
      workflow["13"]["inputs"]["width"] = imagePromptDetail.width;
      workflow["13"]["inputs"]["height"] = imagePromptDetail.height;
      workflow["9"]["inputs"]["filename_prefix"] = "image";

      const generateImage = async () => {
        console.log("imagePromptDetail", imagePromptDetail);

        const outputfiles = await clients[availableClient].client.getOutputFiles(
          workflow,
          "image",
          "png"
        );
        const outputfile = outputfiles[0];
        const buffer = Buffer.from(await outputfile.blob.arrayBuffer());

        fs.writeFileSync(imagePromptDetail.imageFile, buffer);

        completedImages++;
        console.log(`Image generation progress: ${completedImages}/${totalImages}`);

        runInAction(() => {
          clients[availableClient].free = true;
        });
      };
      imagesGenerates.push(generateImage());
    }

    await Promise.all(imagesGenerates);
  });
}

async function generateTextOllama(messages, model) {
  const response = await axios.post(
    `http://localhost:11434/api/chat`,
    {
      messages: messages,
      model,
      stream: false,
      keep_alive: "1s",
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  return response.data.message;
}

async function batchGenerateImagesByPrompts(imagePromptDetails) {
  console.log("Batch generating images");
  await batchGenerateImagesComfyUI(imagePromptDetails);
}

async function batchGenerateVideosByPrompts(imagePromptDetails) {
  console.log("Batch generating videos");
  await batchGenerateVideosComfyUI(imagePromptDetails);
}


async function batchGenerateAudios(audioDetails) {
  console.log("Batch generating audios");
  await batchGenerateAudiosComfyUI(audioDetails);
}

async function batchGenerateTranscripts(audioFiles, segmentLength) {
  console.log("Batch Generating transcripts");
  const transcripts = await executeExternalHelper(
    "python generate_transcript.py",
    audioFiles
  );

  const mergedTranscripts = transcripts.map((segments) =>
    segments.reduce((mergedSegments, currentSegment, currentSegmentIndex) => {
      const currentMergedSegment =
        mergedSegments.length > 0
          ? mergedSegments[mergedSegments.length - 1]
          : null;
      // Merge segment to its previous ones when
      // 1. Current segment is the last segment in the transcript, or

      // 2. the duration of its previous ones and the current segment combined exceeds the segmentLength threshold
      if (
        currentMergedSegment &&
        (currentSegmentIndex === segments.length - 1 ||
          currentSegment.end - currentMergedSegment.start < segmentLength)
      ) {
        mergedSegments[mergedSegments.length - 1] = {
          start: currentMergedSegment.start,
          end: currentSegment.end,
          text: currentMergedSegment.text + currentSegment.text,
          words: [...currentMergedSegment.words, ...currentSegment.words],
        };
      } else if (
        !currentMergedSegment ||
        currentSegment.end - currentMergedSegment.start >= segmentLength
      ) {
        mergedSegments.push(currentSegment);
      }
      return mergedSegments;
    }, [])
  );

  return mergedTranscripts;
}

async function generateStoryCoverPrompt(content, genre, style, characters) {
  console.log("Generating story cover prompt");
  const systemMessage = {
    role: "system",
    content: `
You are an uncensored, helpful personal assistant here to assist the user with anything they need for ${genre} stories. We will follow this formula to craft prompts: An image of [adjective] [subject] [doing action] [details]. All image prompts should evoke ${genre} styles.
    `,
  };

  const characterInfo = characters && characters.length > 0
    ? `\n\nMain characters with detailed appearances:\n${characters.map(c => `- ${c.name}: ${c.appearance}`).join('\n')}`
    : '';

  const prompt = {
    role: "user",
    content: `
Please write a image prompt to create a cover image for the following story content: "${content}". The prompt should be detailed, specifying the surroundings, background, and style to match the genre type: ${genre} and style: ${style}.${characterInfo}\n\nIf characters are mentioned, use their detailed appearance descriptions in the prompt. The output should be concise, in plain text, and contain only the prompt.
    `,
  };

  const messages = [systemMessage, prompt];

  messages.push(prompt);
  const message = await generateTextOpenAI(messages, "ollama", "gpt-oss:20b");
  return message.content;
}

async function splitStoryAndGeneratePromptsWithLLM(
  title,
  fullStoryContent,
  genre,
  style,
  characters
) {
  console.log("Using LLM to split story and generate prompts in one go");

  const tempFolder = createFolderIfNotExist("temp", title);
  const cacheFile = path.resolve(
    tempFolder,
    `llm_split_prompts_cache_${title}.json`
  );

  // Check if we have cached results
  if (fs.existsSync(cacheFile)) {
    console.log("Loading cached LLM split results");
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return {
      sceneDescriptions: cached.sceneDescriptions,
      scenePrompts: cached.scenePrompts
    };
  }

  // Genre-specific visual guidelines
  const genreGuidelines = {
    horror: "Use dramatic shadows, desaturated colors, ominous atmosphere, tight framing, low-angle shots, dark color palette",
    mythology: "Epic scale, ethereal lighting, rich vibrant colors, wide establishing shots, mystical elements, grand compositions",
    kid: "Bright cheerful colors, soft warm lighting, whimsical playful details, eye-level perspective, inviting atmosphere"
  };
  const styleGuide = genreGuidelines[genre] || "Cinematic composition with balanced lighting and natural colors";

  const systemPrompt = {
    role: "system",
    content: `You are a master cinematographer and visual prompt engineer specializing in ${genre} genre with ${style} style.

Your task: Analyze a complete story, intelligently split it into visual scenes (breaking at natural scene transitions marked by *** or significant location/time changes), and generate detailed, filmable image prompts that capture the cinematic essence and emotional atmosphere for each scene.

SCENE SPLITTING RULES:
- Break at *** markers (absolute scene boundaries)
- Break at significant location changes (e.g., indoor to outdoor, different room)
- Break at major time transitions (e.g., day to night, different day)
- Each scene should be around 5 seconds
- Keep related actions in the same scene
- **IMPORTANT: Create scenes of SIMILAR LENGTH - balance the amount of content per scene so they're roughly equal in word count (±20 words)**
- Avoid very short scenes (<15 words) and very long scenes (>100 words)
- Distribute story content evenly across all scenes for consistent pacing

CORE PRINCIPLES:
- Treat each scene as a film frame - consider composition, lighting, depth, and mood
- Maintain visual continuity across scenes (consistent character appearances, locations, lighting conditions)
- ${styleGuide}

IMAGE PROMPT STRUCTURE (follow precisely):
[cinematic_style], [main_subject with full appearance], [specific action/pose], [detailed environment/setting], [lighting type and quality], [camera angle/framing], [atmospheric effects]

CHARACTER HANDLING (CRITICAL):
${characters && characters.length > 0 ? characters.map(c => `- ${c.name}: ${c.appearance}`).join('\n') : 'No characters defined'}

**Only include a character in the prompt if they are mentioned or implied in that specific scene.**
**If a scene mentions "I" or "my", identify which character from context (usually Narrator).**
**Include the character's FULL appearance description from above when they appear.**
**Maintain consistent wardrobe, hair, features across all scenes**

CHARACTER STATE CONTINUITY (CRITICAL):
**Track and maintain character states across scenes (position, action, props, clothing state).**
**If a character is in a specific state in one scene (e.g., hiding under a blanket, holding an object, wearing a hat, sitting), continue describing them in that state in subsequent scenes UNLESS the story explicitly indicates a change.**
**Examples: "kid hiding under blanket" → continue "kid still under blanket" until story says they emerge; "woman holding sword" → keep sword in hand until story mentions putting it down.**
**Pay attention to: body position, held objects, clothing additions/removals, locations within a scene.**

CINEMATIC TECHNIQUES TO INCLUDE:
- Shot types: wide establishing, medium, close-up, over-shoulder
- Camera angles: eye-level, low-angle, high-angle, Dutch tilt
- Lighting: golden hour, dramatic side-lighting, soft diffused, harsh shadows, backlighting
- Depth: shallow/deep focus, bokeh, foreground elements
- Atmosphere: fog, mist, dust particles, rain, volumetric lighting

EXAMPLE QUALITY:
"Cinematic wide shot, 30-year-old Asian male detective in worn trench coat and fedora, standing in rain-soaked alley examining evidence, dark urban noir setting with neon signs reflecting in puddles, dramatic side-lighting from street lamp creating long shadows, low-angle perspective, heavy rain with visible droplets, film noir style"

FOR EACH SCENE, DETERMINE:
1. WHO is in this scene (narrator/character names or describe the subject with full appearance)
2. What ACTION is happening
REQUIREMENTS:
1. Split at *** markers and natural scene boundaries
2. Generate detailed cinematic image prompts for each scene matching the ${genre} genre and ${style} style
3. Each prompt MUST follow the structure: [visual_style], [subject with FULL appearance] [action], [environment], [lighting], [camera angle], [effects]
4. Each prompt = one detailed sentence with all required cinematic elements
5. Ensure all scenes are of SIMILAR LENGTH (word count should be balanced within ±20 words) for consistent video pacing
6. Ensure all characters mentioned are included with FULL appearance details

Generate prompts that a cinematographer could use to set up an actual shot.

Output a JSON object with this structure:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "original story text for this scene",
      "imagePrompt": "detailed cinematic prompt following the structure above"
    },
    ...
  ]
}`
  };

  const userPrompt = {
    role: "user",
    content: `Analyze this story and split it into scenes with image prompts:

${fullStoryContent}

Split at *** markers and natural scene boundaries. Generate detailed cinematic image prompts for each scene matching the ${genre} genre and ${style} style.

CRITICAL: Ensure all scenes are of SIMILAR LENGTH (word count should be balanced within ±20 words). This is essential for consistent video pacing and timing.

Output ONLY valid JSON following the structure specified.`
  };

  const retry = 5;
  let currentRetry = 0;

  while (currentRetry < retry) {
    try {
      console.log(`LLM split attempt ${currentRetry + 1}/${retry}`);

      const message = await generateTextOpenAI(
        [systemPrompt, userPrompt],
        "ollama",
        "gemma3:27b"
      );

      const jsonMatch = message.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
        throw new Error("Invalid scenes array");
      }

      // Validate each scene has required fields
      const validScenes = parsed.scenes.every(
        scene => scene.description && scene.imagePrompt &&
          scene.description.length > 10 && scene.imagePrompt.length > 20
      );

      if (!validScenes) {
        throw new Error("Some scenes are missing required fields or are too short");
      }

      // Validate image prompt quality - should have multiple descriptive elements
      const promptQualityIssues = [];
      parsed.scenes.forEach((scene, idx) => {
        const prompt = scene.imagePrompt;
        const elementCount = prompt.split(',').length;

        // Check if prompt has sufficient detail (at least 3 comma-separated elements)
        if (elementCount < 3) {
          promptQualityIssues.push(`Scene ${idx + 1}: Insufficient detail (${elementCount} elements, need 3+)`);
        }

        // Check if prompt includes visual style keywords
        if (!prompt.match(/\b(cinematic|shot|wide|medium|close-up|angle|lighting|style|atmosphere)\b/i)) {
          promptQualityIssues.push(`Scene ${idx + 1}: Missing cinematic terminology`);
        }

        // If characters exist, check if they're described when mentioned in scene
        if (characters && characters.length > 0) {
          const mentionedChars = characters.filter(c =>
            scene.description.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]) ||
            scene.description.toLowerCase().includes(c.name.toLowerCase())
          );

          for (const char of mentionedChars) {
            const hasCharInPrompt = prompt.toLowerCase().includes(char.name.toLowerCase()) ||
              prompt.toLowerCase().includes(char.appearance.split(',')[0].toLowerCase());
            if (!hasCharInPrompt) {
              promptQualityIssues.push(`Scene ${idx + 1}: Character ${char.name} in scene but missing from prompt`);
            }
          }
        }
      });

      if (promptQualityIssues.length > 0) {
        console.warn(`⚠ Image prompt quality issues detected:`);
        promptQualityIssues.slice(0, 5).forEach(issue => console.warn(`  - ${issue}`));
        if (promptQualityIssues.length > 5) {
          console.warn(`  ... and ${promptQualityIssues.length - 5} more issues`);
        }

        // If too many issues and we have retries left, regenerate
        if (promptQualityIssues.length > parsed.scenes.length * 0.3 && currentRetry < retry - 1) {
          throw new Error(`Too many prompt quality issues (${promptQualityIssues.length}/${parsed.scenes.length} scenes)`);
        }
      } else {
        console.log(`✓ Image prompt quality validation passed`);
      }

      // Validate scene lengths are similar for consistent pacing
      const sceneLengths = parsed.scenes.map(s => s.description.split(/\s+/).length);
      const avgLength = sceneLengths.reduce((a, b) => a + b, 0) / sceneLengths.length;
      const maxDeviation = Math.max(...sceneLengths.map(len => Math.abs(len - avgLength)));
      const lengthVariance = maxDeviation / avgLength;

      if (lengthVariance > 0.5) {
        console.warn(`⚠ Scene length variance detected: ${(lengthVariance * 100).toFixed(1)}%`);
        console.warn(`  Average: ${avgLength.toFixed(1)} words, Max deviation: ${maxDeviation.toFixed(1)} words`);
        console.warn(`  Scene lengths: ${sceneLengths.join(', ')}`);

        // If variance is too high and we have retries left, ask for rebalancing
        if (lengthVariance > 0.7 && currentRetry < retry - 1) {
          throw new Error(`Scene lengths too unbalanced (${(lengthVariance * 100).toFixed(1)}% variance). Need more even distribution.`);
        }
      } else {
        console.log(`✓ Scene length consistency good: avg ${avgLength.toFixed(1)} words, variance ${(lengthVariance * 100).toFixed(1)}%`);
      }

      const sceneDescriptions = parsed.scenes.map(s => s.description);
      const scenePrompts = parsed.scenes.map(s => s.imagePrompt);

      console.log(`✓ Successfully split story into ${sceneDescriptions.length} scenes with prompts`);

      // Cache the results
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          sceneDescriptions,
          scenePrompts,
          timestamp: new Date().toISOString()
        }, null, 2)
      );

      return { sceneDescriptions, scenePrompts };

    } catch (ex) {
      console.log(`Attempt ${currentRetry + 1} failed:`, ex.message);
      currentRetry++;

      if (currentRetry >= retry) {
        throw new Error(`Failed to split story with LLM after ${retry} attempts: ${ex.message}`);
      }
    }
  }
}

async function generateContinousStoryScenePrompts(
  title,
  sceneDescriptions,
  genre,
  style,
  characters
) {
  console.log("Batch Generating scene prompts");
  const splitLimit = 3;
  const tempFolder = createFolderIfNotExist("temp", title);
  const cacheFile = path.resolve(
    tempFolder,
    `image_prompts_cache_${title}_${splitLimit}.json`
  );

  const cache = fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
    : null;

  const scenePrompts = cache ? cache.scenePrompts : [];
  let index = cache ? cache.index + 1 : 0;

  // Genre-specific visual guidelines
  const genreGuidelines = {
    horror: "Use dramatic shadows, desaturated colors, ominous atmosphere, tight framing, low-angle shots, dark color palette",
    mythology: "Epic scale, ethereal lighting, rich vibrant colors, wide establishing shots, mystical elements, grand compositions",
    kid: "Bright cheerful colors, soft warm lighting, whimsical playful details, eye-level perspective, inviting atmosphere"
  };
  const styleGuide = genreGuidelines[genre] || "Cinematic composition with balanced lighting and natural colors";

  // Enhanced system prompt for cinematic scene capture
  const systemPrompt = {
    role: "system",
    content: `You are a master cinematographer and visual prompt engineer specializing in ${genre} genre with ${style} style.

Your goal: Transform story scenes into detailed, filmable image prompts that capture the cinematic essence and emotional atmosphere.

CORE PRINCIPLES:
- Treat each scene as a film frame - consider composition, lighting, depth, and mood
- Maintain visual continuity across scenes (consistent character appearances, locations, lighting conditions)
- ${styleGuide}

PROMPT STRUCTURE (follow precisely):
[cinematic_style], [main_subject with full appearance], [specific action/pose], [detailed environment/setting], [lighting type and quality], [camera angle/framing], [atmospheric effects]

CHARACTER CONSISTENCY:
- Always include complete physical descriptions when characters appear
- Maintain consistent wardrobe, hair, features across scenes
- Use age, ethnicity, build, distinctive features

CHARACTER STATE CONTINUITY (CRITICAL):
- Track character states from previous scenes (position, action, props, clothing state)
- If a character was in a specific state in a previous scene (e.g., hiding under blanket, holding object, sitting, wearing specific item), continue that state in subsequent scenes UNLESS the current scene explicitly indicates a change
- Examples: "kid hiding under blanket" in Scene 1 → Scene 2 should continue "kid still hidden under blanket" until story shows them emerging
- Pay attention to: body positions, held objects, clothing additions/removals, character locations within scene

CINEMATIC TECHNIQUES:
- Specify shot types: wide establishing, medium, close-up, over-shoulder
- Camera angles: eye-level, low-angle, high-angle, Dutch tilt
- Lighting: golden hour, dramatic side-lighting, soft diffused, harsh shadows, backlighting
- Depth: shallow/deep focus, bokeh, foreground elements
- Atmosphere: fog, mist, dust particles, rain, volumetric lighting

EXAMPLE QUALITY:
"Cinematic wide shot, 30-year-old Asian male detective in worn trench coat and fedora, standing in rain-soaked alley examining evidence, dark urban noir setting with neon signs reflecting in puddles, dramatic side-lighting from street lamp creating long shadows, low-angle perspective, heavy rain with visible droplets, film noir style"

Generate prompts that a cinematographer could use to set up an actual shot.`
  };

  // Initialize messages with system prompt
  let messages = cache ? cache.messages : [
    systemPrompt
  ];

  const sceneDescriptionChunks = splitArrayIntoChunks(
    sceneDescriptions,
    splitLimit
  );

  const retry = 5;
  const contextSize = 5;

  //const message = await generateText(messages);
  for (; index < sceneDescriptionChunks.length; index++) {
    console.log(
      `##############Creating scene prompts for chunk ${index + 1}/${sceneDescriptionChunks.length}`
    );
    const sceneDescriptionChunk = sceneDescriptionChunks[index];

    // Reduce context window from 100 to 3-5 previous scenes
    const lastSceneDescriptions = index > 0
      ? sceneDescriptions.slice(Math.max(0, index * splitLimit - contextSize), index * splitLimit)
      : [];

    // Enhanced prompt with explicit scene-to-prompt mapping
    const promptText = `Generate ${sceneDescriptionChunk.length} cinematic image prompts. Each prompt MUST correspond EXACTLY to its scene number.

STRUCTURE (mandatory):
[visual_style], [subject 1 with FULL appearance] [action],  [subject 2 with FULL appearance] [action], [subject 3 with FULL appearance] [action] (repeat if needed), [environment], [lighting], [camera angle], [effects]

CHARACTER RULES (CRITICAL):
${characters && characters.length > 0 ? characters.map(c => `- ${c.name}: ${c.appearance}`).join('\n') : 'No characters defined'}

**Only include a character in the prompt if they are mentioned or implied in that specific scene.**
**If a scene mentions "I" or "my", identify which character from context (usually Narrator).**
**Include the character's FULL appearance description from above when they appear.**

STYLE: ${genre} genre, ${style} style - ${styleGuide}

${lastSceneDescriptions.length > 0 ? `PREVIOUS SCENES (for continuity):\n${lastSceneDescriptions.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` : ''}SCENES TO GENERATE PROMPTS FOR:
${sceneDescriptionChunk.map((s, i) => `Scene ${i + 1}: "${s}"`).join('\n')}

FOR EACH SCENE:
1. Identify WHO is in this scene (narrator/character names or describe the subject)
2. What ACTION is happening (check if character continues previous state from earlier scenes)
3. WHERE it takes place
4. HOW it's lit and framed
5. WHAT atmosphere/mood
6. Ensure all characters mentioned are included with FULL appearance details
7. MAINTAIN CHARACTER STATES: If a character had a specific position/prop/action in previous scenes, continue that state unless current scene indicates a change

Output EXACTLY ${sceneDescriptionChunk.length} prompts as JSON array: ["prompt1", "prompt2", ...]
Each prompt = one detailed sentence with all required elements.`;
    const prompt = {
      role: "user",
      content: promptText,
    };
    // Keep system prompt + recent conversation history
    if (messages.length > 10) {
      const recentMessages = messages.slice(Math.max(messages.length - 3, 1));
      messages = [systemPrompt, ...recentMessages.filter(m => m.role !== 'system')];
    }
    messages.push(prompt);

    let message = undefined;
    let generated = false;
    let currentRetry = 0;

    while (currentRetry < retry) {
      try {
        console.log(`Attempt #${currentRetry + 1}`);
        const regex = /\[[\s\S]{10,}\]/gm;
        message = await generateTextOpenAI(messages, "ollama", "gpt-oss:20b");
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);
          console.log(JSON.stringify(parsed, null, 4), sceneDescriptionChunk);

          // Enhanced validation
          if (
            sceneDescriptionChunk.length === parsed.length &&
            parsed.every((item) => item && typeof item === 'string' && item.length > 20)
          ) {
            // Quality validation: check for character consistency
            let hasQualityIssues = false;
            let issueDetails = [];

            for (let i = 0; i < parsed.length; i++) {
              const prompt = parsed[i];
              const scene = sceneDescriptionChunk[i];

              // Check 1: Prompt should mention visual style
              if (!prompt.match(/\b(cinematic|horror|photorealistic|oil painting|anime|3D render|wide shot|medium shot|close-up)\b/i)) {
                hasQualityIssues = true;
                issueDetails.push(`Scene ${i + 1}: Missing visual style/shot type`);
              }

              // Check 2: If scene mentions character names, prompt should too (or describe them)
              if (characters && characters.length > 0) {
                const mentionedChars = characters.filter(c =>
                  scene.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]) ||
                  scene.toLowerCase().includes(c.name.toLowerCase())
                );

                for (const char of mentionedChars) {
                  const charNameInPrompt = prompt.toLowerCase().includes(char.name.toLowerCase());
                  const charTraitsInPrompt = char.appearance.split(',')[0].toLowerCase();
                  const hasCharDescription = prompt.toLowerCase().includes(charTraitsInPrompt);

                  if (!charNameInPrompt && !hasCharDescription) {
                    hasQualityIssues = true;
                    issueDetails.push(`Scene ${i + 1}: Character ${char.name} mentioned in scene but missing from prompt`);
                  }
                }
              }

              // Check 3: Prompt should have sufficient detail (commas indicate detail)
              if (prompt.split(',').length < 3) {
                hasQualityIssues = true;
                issueDetails.push(`Scene ${i + 1}: Insufficient detail (less than 3 descriptive elements)`);
              }
            }

            if (!hasQualityIssues) {
              console.log("✓ Quality validation passed", parsed.length);
              scenePrompts.push(...parsed);

              messages.push(message);
              fs.writeFileSync(
                cacheFile,
                JSON.stringify({
                  messages,
                  scenePrompts,
                  index,
                  splitLimit,
                })
              );
              generated = true;
              break;
            } else {
              console.warn(`✗ Quality issues detected (attempt ${currentRetry + 1}):`);
              issueDetails.forEach(issue => console.warn(`  - ${issue}`));

              // Add feedback to help LLM correct mistakes
              if (currentRetry < retry - 1) {
                messages.push({
                  role: "user",
                  content: `The prompts have quality issues:
        ${issueDetails.join('\n')}

        SCENES CONTEXT:
        ${sceneDescriptionChunk.map((s, i) => `Scene ${i + 1}: "${s}"`).join('\n')}

        ${characters && characters.length > 0 ? `CHARACTER REFERENCES:
        ${characters.map(c => `- ${c.name}: ${c.appearance}`).join('\n')}` : ''}

        Please regenerate the ${sceneDescriptionChunk.length} prompts with:
        1. Proper cinematic style and shot type at the start
        2. Character names and full appearance details when they appear in scenes (use CHARACTER REFERENCES above)
        3. At least 3-5 descriptive elements (style, subject, action, environment, lighting, effects)
        4. Ensure each prompt matches its corresponding scene content from SCENES CONTEXT

        Output ONLY the corrected JSON array: ["prompt1", "prompt2", ...]`
                });
              }
            }
          }
        }
        currentRetry++;
      } catch (ex) {
        console.log(ex);
        currentRetry++;
      }
    }

    if (!generated) {
      console.warn(`⚠ Max attempts (${retry}) reached. Using last generated prompts.`);
      // Use the last parsed prompts even if they have quality issues
      const regex = /\[[\s\S]{10,}\]/gm;
      const matches = message?.content?.match(regex);
      if (matches && matches.length > 0) {
        const parsed = JSON.parse(matches[0]);
        if (parsed.length === sceneDescriptionChunk.length) {
          scenePrompts.push(...parsed);
          messages.push(message);
          fs.writeFileSync(
            cacheFile,
            JSON.stringify({
              messages,
              scenePrompts,
              index,
              splitLimit,
            })
          );
        } else {
          throw "Error creating story lines: Max attempts reached and last output has wrong length";
        }
      } else {
        throw "Error creating story lines: Max attempts reached and no valid output";
      }
    }
  }

  fs.existsSync(cacheFile) && fs.unlinkSync(cacheFile);
  return scenePrompts;
}

async function generateContinousStorySceneVideoPrompts(
  title,
  sceneDescriptions,
  sceneImagePrompts,
  genre,
  style,
  characters
) {
  console.log("Batch Generating video prompts");
  const splitLimit = 3;
  const tempFolder = createFolderIfNotExist("temp", title);
  const cacheFile = path.resolve(
    tempFolder,
    `image_prompts_cache_${title}_${splitLimit}.json`
  );

  const cache = fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
    : null;

  const videoPrompts = cache ? cache.videoPrompts : [];
  let index = cache ? cache.index + 1 : 0;

  let messages = cache ? cache.messages : [

  ];

  const combinedSceneDescriptions = sceneDescriptions.map(
    (sceneDescription, index) => ({
      sceneDescription,
      imagePrompt: sceneImagePrompts[index],
    })
  );


  const sceneDescriptionChunks = splitArrayIntoChunks(
    combinedSceneDescriptions,
    splitLimit
  );

  const retry = 5;
  //const message = await generateText(messages);
  for (; index < sceneDescriptionChunks.length; index++) {
    console.log(
      `##############Creating video prompts for chunk ${index + 1}/${sceneDescriptionChunks.length}`
    );
    const lastSceneDescriptions = index > 0
      ? sceneDescriptions.slice(Math.max(0, index * splitLimit - 100), index * splitLimit)
      : [];

    const sceneDescriptionChunk = sceneDescriptionChunks[index];
    const promptText = `
You are a master cinematographer and video generation expert specializing in ${genre} genre with ${style} style. Your task is to generate highly detailed, cinematic video prompts for LTX-2 video generation model following the official LTX-2 prompting guidelines.

CORE PRINCIPLES (LTX-2 Prompting Guide):
• Write in a single flowing paragraph (NOT JSON format)
• Use present tense verbs to describe movement and action
• Include 4-8 descriptive sentences covering all key aspects
• Paint a complete picture that flows naturally from beginning to end

PROMPT STRUCTURE (follow this order):
1. Establish the shot: Use cinematography terms (wide shot, medium shot, close-up, handheld, static, dolly, tracking, pan, crane, over-the-shoulder, etc.)
2. Set the scene: Lighting conditions, color palette, textures, atmosphere (fog, rain, dust, smoke, etc.)
3. Describe the action: Write as a natural sequence, flowing from beginning to end in present tense
4. Define characters: Include age, ethnicity, hairstyle, clothing, distinguishing details. Use physical cues for emotions (avoid labels like "sad" - describe posture/gesture instead)
5. Identify camera movement: Specify when/how the view shifts (pans, tracks, dollies, pushes in, pulls back, circles around, tilts, handheld tracking, arcs)
6. Describe audio: Ambient sounds, music, dialogue (use quotation marks for speech, mention accent if needed)

WHAT WORKS WELL WITH LTX-2:
• Cinematic compositions with thoughtful lighting and shallow depth of field
• Emotive human moments, subtle gestures, facial nuances
• Atmosphere: fog, mist, golden hour light, soft shadows, rain, reflections
• Clear camera language: "slow dolly in", "handheld tracking", "camera pans right"
• Stylized aesthetics matching ${genre} genre and ${style} style
• Lighting/mood control: backlighting, color palettes, soft rim light, flickering candles
• Natural motion: walking, turning, dancing (avoid complex physics like jumping/juggling)

WHAT TO AVOID:
• Emotional labels without visual cues (use posture/gesture/facial expression)
• Text/logos/signage (model doesn't generate readable text)
• Complex physics or chaotic motion
• Scene complexity overload (too many characters/actions)
• Overcomplicated prompts (keep focused and clear)

${characters && characters.length > 0 ? `MAIN CHARACTERS (use these detailed descriptions when they appear):\n${characters.map(c => `- ${c.name}: ${c.appearance}`).join('\n')}\n` : ''}
${lastSceneDescriptions.length > 0 ? `PREVIOUS SCENES FOR CONTEXT:\n${lastSceneDescriptions.slice(-5).map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` : ''}
SCENES TO GENERATE PROMPTS FOR:
${sceneDescriptionChunk.map((s, i) => `Scene ${i + 1}:
- Scene Description: "${s.sceneDescription}"
- Image Prompt: "${s.imagePrompt}"`).join('\n\n')}

FOR EACH SCENE:
Generate ONE flowing paragraph (not JSON) that:
• Starts with shot type and camera setup
• Describes environment, lighting, and color palette
• Details subject(s) with full appearance when characters appear
• Describes action sequence in present tense
• Includes camera movement throughout
• Mentions ambient sounds or dialogue if relevant
• Matches ${genre} genre and ${style} style

EXAMPLE FORMAT:
"A cinematic medium shot in warm golden hour light. The camera opens on a 30-year-old Asian woman with long black hair in a flowing blue dress, standing at the edge of a misty lake. Soft amber light filters through the fog as she turns slowly toward the camera, her expression contemplative. The camera dollies in gradually, maintaining focus on her face as atmospheric fog drifts between lens and subject. In the distance, birds call softly over gentle water sounds. The color palette is muted blues and warm golds with soft shadows. As she begins to walk forward, the camera tracks alongside her in smooth handheld motion."

Output EXACTLY ${sceneDescriptionChunk.length} video prompts as a JSON array of strings: ["prompt1", "prompt2", ...]
Each prompt should be one detailed flowing paragraph (NOT JSON objects).
`;
    const prompt = {
      role: "user",
      content: promptText,
    };
    if (messages.length > 5) {
      messages = [...messages.slice(Math.max(messages.length - 3, 0))];
    }
    messages.push(prompt);

    let message = undefined;
    let generated = false;
    let currentRetry = 0;

    while (currentRetry < retry) {
      try {
        console.log(`Attempt #${currentRetry + 1} `);
        const regex = /\[[\s\S]{10,}\]/gm;
        message = await generateTextOpenAI(messages, "ollama", "gpt-oss:20b");
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);
          console.log(parsed, sceneDescriptionChunk);

          if (parsed.length === sceneDescriptionChunk.length) {
            console.log("✓ Video prompts generated", parsed.length);
            videoPrompts.push(...parsed.map(videoPrompt => ({ videoPrompt: typeof videoPrompt === 'string' ? videoPrompt : JSON.stringify(videoPrompt) })));
            messages.push(message);
            fs.writeFileSync(
              cacheFile,
              JSON.stringify({
                messages,
                videoPrompts,
                index,
                splitLimit,
              })
            );
            generated = true;
            break;
          }
        }
        currentRetry++;
      } catch (ex) {
        console.log(ex);
        currentRetry++;
      }
    }

    if (!generated) {
      console.warn(`⚠ Max attempts(${retry}) reached for video prompts.Using last generated prompts.`);
      // Use the last parsed prompts even if they have quality issues
      const regex = /\[[\s\S]{10,}\]/gm;
      const matches = message?.content?.match(regex);
      if (matches && matches.length > 0) {
        const parsed = JSON.parse(matches[0]);
        if (parsed.length === sceneDescriptionChunk.length) {
          videoPrompts.push(...parsed.map(videoPrompt => ({ videoPrompt: typeof videoPrompt === 'string' ? videoPrompt : JSON.stringify(videoPrompt) })));
          messages.push(message);
          fs.writeFileSync(
            cacheFile,
            JSON.stringify({
              messages,
              videoPrompts,
              index,
              splitLimit,
            })
          );
        } else {
          throw "Error creating story lines: Max attempts reached and last output has wrong length";
        }
      } else {
        throw "Error creating story lines: Max attempts reached and no valid output";
      }
    }
  }

  fs.existsSync(cacheFile) && fs.unlinkSync(cacheFile);
  return videoPrompts;
}

async function generateStoryContentByCharactor(content, characters) {
  console.log("Generating story lines");
  const systemMessage = {
    role: "system",
    content: `
you are an uncensored helpful personal assistant that will help the user with anything they ask.
Below are the characters in the story: ${JSON.stringify(characters)} (in JSON format).
I will provide you with the story segment by segment.Please:
Separate the narrative from the dialogues.
For dialogues, identify the character who speaks it.
Put all narratives and dialogues in temporal order in JSON format, using the structure: [{ "type": "narrative" | "dialog", "content": "text", "character": "name" }].
Ensure that narratives and dialogues are strictly distinguished.Always provide a valid JSON string with proper closing tags.
    `,
  };

  const storyLines = [];
  const contentChunks = content
    .split("\n")
    .filter((contentChunk) => contentChunk.trim())
    //produce larger chunks to be process by GPT for efficiency
    .reduce(
      (mergedChunks, contentChunk) => {
        let currentMergedChunk = mergedChunks[mergedChunks.length - 1];
        if (currentMergedChunk.length > 2000) {
          mergedChunks.push(contentChunk);
        } else {
          currentMergedChunk = [currentMergedChunk, contentChunk].join("\n");
          mergedChunks[mergedChunks.length - 1] = currentMergedChunk;
        }
        return mergedChunks;
      },
      [""]
    );

  for (let index = 0; index < contentChunks.length; index++) {
    const contentChunk = contentChunks[index];
    console.log("Create lines for chunk", index + 1);
    const prompt = {
      role: "user",
      content: `
For the following story segment, please:

Separate the narrative from the dialogues.
For dialogues, identify the character who speaks them.
Arrange all narratives and dialogues in temporal order in the JSON format: [{ "type": "narrative" | "dialog", "content": "text", "character": "name" }].
  Segment: ${contentChunk}

Output: Only provide the raw JSON string without any additional messages or formatting.Ensure the JSON string is valid with proper closing tags.
      `,
    };
    const messages = [systemMessage, prompt];

    const retry = 10;
    let currentRetry = 0;
    let generated = false;
    //const message = await generateText(messages);
    while (currentRetry < retry) {
      console.log("Attempt #", currentRetry + 1);
      try {
        const regex = /\[[\s\S]{10,}\]/gm;
        const message = await generateTextOpenAI(
          messages,
          "ollama", "gpt-oss:20b");
        console.log("message", message);
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);
          if (
            stringSimilarity(
              contentChunk,
              parsed.map((object) => object.content).join("\n")
            ) > 0.8 &&
            parsed.every((object) => object.content && object.type)
          ) {
            storyLines.push(...JSON.parse(matches[0]));
            generated = true;
            break;
          }
        }
      } catch (ex) {
        console.log("Error creating story lines", ex);
        currentRetry++;
      }
    }

    if (!generated) {
      throw "Error creating story lines";
    }
  }

  //merged consective chunks of the same characters
  return storyLines.reduce((mergedStoryLines, currentStoryLine) => {
    const currentMergedStoryLine =
      mergedStoryLines.length > 0
        ? mergedStoryLines[mergedStoryLines.length - 1]
        : null;
    if (
      !currentMergedStoryLine ||
      currentMergedStoryLine.character !== currentStoryLine.character
    ) {
      mergedStoryLines.push(currentStoryLine);
    } else {
      mergedStoryLines[mergedStoryLines.length - 1] = {
        ...currentStoryLine,
        content:
          currentMergedStoryLine.content + "\n" + currentStoryLine.content,
      };
    }
    return mergedStoryLines;
  }, []);
}

async function extractCharactersWithAppearance(content) {
  console.log("Extracting characters with detailed appearances from story");

  const systemMessage = {
    role: "system",
    content: `
You are an expert character analyst.Extract all main characters from stories and provide extremely detailed visual descriptions suitable for AI image generation.

For each character, provide:
- name: Character's full name
  - gender: male / female / other
    - appearance: Comprehensive visual description including:
  * Age and age - related features
  * Ethnicity / race and associated features
    * Facial structure, shape, and distinctive features
      * Eye color, shape, and expression
        * Hair color, length, style, texture
          * Skin tone and texture
            * Body type, height, build
              * Typical clothing style, colors, and materials
                * Accessories, jewelry, or distinctive items
                  * Any scars, tattoos, or unique markings
                    * Overall aesthetic or visual style
                      - voiceType: Description of voice characteristics

                        ** Keep appearance under 50 words **
                          Be as specific and visual as possible.If details aren't in the story, infer them logically based on context.
                            `,
  };

  const prompt = {
    role: "user",
    content: `
Extract all main characters from the following story.For each character, provide a JSON object with detailed appearance information.

  Format: [{ "name": "character name", "gender": "male/female/other", "appearance": "extremely detailed visual description suitable for image generation", "voiceType": "voice characteristics" }]

Be extremely specific about appearance.Include:
- Age(e.g., "middle-aged woman in her 40s", "young boy around 8 years old")
  - Race / ethnicity(e.g., "East Asian", "African American", "Caucasian with Mediterranean features")
  - Facial features(e.g., "sharp angular jawline", "round face with high cheekbones", "almond-shaped green eyes")
    - Hair(e.g., "long flowing black hair with slight waves", "short cropped gray hair", "curly red hair in a ponytail")
    - Skin(e.g., "pale porcelain skin", "dark brown skin with warm undertones", "olive complexion")
    - Body type(e.g., "tall and lean athletic build", "short and stocky", "average height with muscular frame")
      - Clothing style(e.g., "elegant Victorian dress in deep purple", "worn leather jacket and jeans", "traditional Japanese kimono")
        - Distinctive features(e.g., "scar across left eyebrow", "always wears a silver locket", "crooked smile")

Story:
${content}

Output ONLY the JSON array, no other text.
    `,
  };

  const retry = 10;
  let currentRetry = 0;

  while (currentRetry < retry) {
    try {
      console.log(`Attempt #${currentRetry + 1}`);
      const messages = [systemMessage, prompt];
      const message = await generateTextOpenAI(messages, "ollama", "gpt-oss:20b");

      let jsonContent = message.content.trim();

      // Try to extract JSON if wrapped in markdown code blocks
      const jsonMatch = jsonContent.match(/```(?: json) ?\s * (\[[\s\S] *\]) \s * ```/);
      if (jsonMatch) {
        jsonContent = jsonMatch[1];
      }

      // Clean up common issues
      jsonContent = jsonContent.replace(/```json/g, "").replace(/```/g, "").replace(/\.\.\./g, "");

      const parsed = JSON.parse(jsonContent);

      // Validate that we have a proper array with required fields
      if (Array.isArray(parsed) && parsed.length > 0 &&
        parsed.every(char => char.name && char.gender && char.appearance && char.voiceType)) {
        console.log(`Successfully extracted ${parsed.length} characters`);
        return parsed;
      } else {
        throw new Error("Invalid character data structure");
      }
    } catch (ex) {
      console.log(`Extraction attempt ${currentRetry + 1} failed:`, ex.message);
      currentRetry++;

      if (currentRetry >= retry) {
        throw new Error(`Failed to extract characters after ${retry} attempts: ${ex.message}`);
      }
    }
  }

  throw new Error("Failed to extract characters from story");
}

async function speedUpAudio(audioFilePath, speedFactor) {
  const outputFile = audioFilePath.replace(".mp3", "_speedup.mp3");
  await exec(
    `ffmpeg -i "${audioFilePath}" -filter_complex "[0]atempo=${speedFactor}[a]" -map "[a]" -y "${outputFile}"`
  );
  return outputFile;
}

exports.batchGenerateImagesByPrompts = batchGenerateImagesByPrompts;
exports.batchGenerateVideosByPrompts = batchGenerateVideosByPrompts;
exports.batchGenerateAudios = batchGenerateAudios;
exports.batchGenerateTranscripts = batchGenerateTranscripts;
exports.generateContinousStoryScenePrompts = generateContinousStoryScenePrompts;
exports.generateContinousStorySceneVideoPrompts = generateContinousStorySceneVideoPrompts;
exports.extractCharactersWithAppearance = extractCharactersWithAppearance;
exports.generateStoryContentByCharactor = generateStoryContentByCharactor;
exports.generateStoryCoverPrompt = generateStoryCoverPrompt;
exports.splitStoryAndGeneratePromptsWithLLM = splitStoryAndGeneratePromptsWithLLM;
exports.speedUpAudio = speedUpAudio;
