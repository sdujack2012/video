const fs = require("fs");
const path = require("path");
const axios = require("axios");
const OpenAI = require("openai");
const { stringSimilarity } = require("string-similarity-js");
const {
  executeExternalHelper,
  splitArrayIntoChunks,
  createFolderIfNotExist,
  registerExitCallback,
} = require("./utils");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const { ComfyUIClient } = require("./comfyui_client");
const { observable, when, runInAction } = require("mobx");

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


async function generateTextComfyui(client, { prompt, image, model }) {
  const indexTTS2 = JSON.parse(
    fs.readFileSync("./comfyUI workflows/qwen3_vl.json")
  );

  indexTTS2["114"]["inputs"]["seed"] = Math.floor(
    Math.random() * 4294967294
  );
  indexTTS2["114"]["inputs"]["custom_prompt"] = prompt;
  indexTTS2["97"]["inputs"]["image"] = image;
  indexTTS2["114"]["inputs"]["model_name"] = model;

  const outputTexts = await client.getOutputText(
    indexTTS2,
    "txt",
    "txt"
  );

  return outputTexts[0];
}

async function freeVRams() {
  try {
    await axios.post(
      "http://localhost:11434/api/generate",
      '{"model": "deepseek-r1:7b", "keep_alive": 0}',
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
  } catch (ex) {
    console.error(ex);
  }
}

async function generateImage(prompt, width, height) {
  const response = await axios.get(
    `http://127.0.0.1:8188/text2image`,
    {
      params: {
        prompt,
        width,
        height,
        num_inference_steps: 30,
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  return response.data.data;
}

async function freeComfyUIMemory(client) {
  try {
    const freeMemoryWorkflow = JSON.parse(
      fs.readFileSync("./comfyUI workflows/free_memory.json")
    );
    await client.execute(
      freeMemoryWorkflow
    );
  } catch (ex) {
    console.log(ex);
  }
}

async function batchGenerateAudiosComfyUI(audioDetails) {
  const clients = observable([]);
  const clientId = Math.floor(Math.random() * 4294967294);

  try {
    const serverAddress1 = "127.0.0.1:8188";
    const client1 = new ComfyUIClient(serverAddress1, clientId);
    await client1.connect();
    clients.push({ client: client1, free: true });
  } catch (ex) {
    console.log(ex);
  }

  try {
    const serverAddress2 = "127.0.0.1:8189";
    const client2 = new ComfyUIClient(serverAddress2, clientId);
    await client2.connect();
    clients.push({ client: client2, free: true });
  } catch (ex) {
    console.log(ex);
  }

  const audioGenerates = [];
  registerExitCallback(async () => {
    clients.forEach(async (client) => {
      await client.client.interrupt();
      await freeComfyUIMemory(client.client);
      await client.client.disconnect();
    });
  });

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
      fs.readFileSync("./comfyUI workflows/index_tts2.json")
    );

    indexTTS2["27"]["inputs"]["seed"] = Math.floor(
      Math.random() * 4294967294
    );
    indexTTS2["27"]["inputs"]["text"] = audioDetail.text;
    indexTTS2["29"]["inputs"]["audio"] = audioDetail.speakerVoiceFile;
    indexTTS2["49"]["inputs"]["filename_prefix"] = "audio";

    const generateAudio = async () => {
      const outputfiles = await clients[availableClient].client.getOutputFiles(
        indexTTS2,
        "audio",
        "mp3"
      );
      const outputfile = outputfiles[0];
      const buffer = Buffer.from(await outputfile.blob.arrayBuffer());

      fs.writeFileSync(audioDetail.outputFile, buffer);

      runInAction(() => {
        clients[availableClient].free = true;
      });
    };
    audioGenerates.push(generateAudio());
  }

  await Promise.all(audioGenerates);
  await Promise.all(clients.map((client) =>
    freeComfyUIMemory(client.client)
  ));
  await Promise.all(clients.map((client) => client.client.disconnect()));
}

async function batchGenerateVideosComfyUI(imagePromptDetails) {
  const clients = observable([]);
  const clientId = Math.floor(Math.random() * 4294967294);

  try {
    const serverAddress1 = "127.0.0.1:8188";
    const client1 = new ComfyUIClient(serverAddress1, clientId);
    await client1.connect();
    clients.push({ client: client1, free: true });
  } catch (ex) {
    console.log(ex);
  }

  const imagesGenerates = [];
  registerExitCallback(async () => {
    clients.forEach(async (client) => {
      await client.client.interrupt();
      await freeComfyUIMemory(client.client);
      await client.client.disconnect();
    });
  });

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
    //   fs.readFileSync("./comfyUI workflows/wan2.2-t2v-rapid-aio-gguf.json")
    // );

    // workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["5"]["inputs"]["text"] =
    //   imagePromptDetail.style +
    //   ", " +
    //   imagePromptDetail.prompt;
    // workflow["6"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["6"]["inputs"]["height"] = imagePromptDetail.height;
    // workflow["8"]["inputs"]["filename_prefix"] = "video";


    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/Rapid-AIO-Mega-t2v.json")
    // );

    // workflow["8"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["9"]["inputs"]["text"] =
    //   imagePromptDetail.style +
    //   ", " +
    //   imagePromptDetail.prompt;
    // workflow["44"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["44"]["inputs"]["height"] = imagePromptDetail.height;
    // workflow["39"]["inputs"]["filename_prefix"] = "video";

    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/Rapid-AIO-Mega-i2v.json")
    // );

    // workflow["8"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["9"]["inputs"]["text"] =
    //   imagePromptDetail.style +
    //   ", " +
    //   imagePromptDetail.prompt;
    // workflow["28"]["inputs"]["width"] = imagePromptDetail.width / 2;
    // workflow["28"]["inputs"]["height"] = imagePromptDetail.height / 2;
    // workflow["16"]["inputs"]["image"] = imagePromptDetail.imageFile;
    // workflow["39"]["inputs"]["filename_prefix"] = "video";

    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/wan2.2_lighting.json")
    // );

    // workflow["57"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["58"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["6"]["inputs"]["text"] =
    //   imagePromptDetail.style +
    //   ", " +
    //   imagePromptDetail.prompt;
    // workflow["59"]["inputs"]["width"] = imagePromptDetail.width / 2;
    // workflow["59"]["inputs"]["height"] = imagePromptDetail.height / 2;
    // workflow["78"]["inputs"]["filename_prefix"] = "video";


    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/wan2.2_i2v.json")
    // );

    // workflow["86"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["93"]["inputs"]["text"] = imagePromptDetail.refinedVideoPrompt;
    // workflow["98"]["inputs"]["width"] = imagePromptDetail.width / 2;
    // workflow["98"]["inputs"]["height"] = imagePromptDetail.height / 2;
    // workflow["97"]["inputs"]["image"] = imagePromptDetail.imageFile;
    // workflow["108"]["inputs"]["filename_prefix"] = "video";

    const workflow = JSON.parse(
      fs.readFileSync("./comfyUI workflows/wan2.2_i2v_painter.json")
    );
    workflow["86"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
    console.log("imagePromptDetail.refinedVideoPrompt || imagePromptDetail.videoPrompt", imagePromptDetail, imagePromptDetail.refinedVideoPrompt, imagePromptDetail.videoPrompt)
    workflow["93"]["inputs"]["text"] = JSON.stringify(imagePromptDetail.refinedVideoPrompt || imagePromptDetail.videoPrompt);
    workflow["114"]["inputs"]["width"] = imagePromptDetail.width / 2;
    workflow["114"]["inputs"]["height"] = imagePromptDetail.height / 2;
    workflow["97"]["inputs"]["image"] = imagePromptDetail.imageFile;
    workflow["108"]["inputs"]["filename_prefix"] = "video";

    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/wan2.2_lighting.json")
    // );

    // workflow["86"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["117"]["inputs"]["String"] =
    //   imagePromptDetail.refinedVideoPrompt;
    // workflow["98"]["inputs"]["width"] = imagePromptDetail.width / 2;
    // workflow["98"]["inputs"]["height"] = imagePromptDetail.height / 2;
    // workflow["97"]["inputs"]["image"] = imagePromptDetail.imageFile;
    // workflow["108"]["inputs"]["filename_prefix"] = "video";


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


    const generateImage = async () => {
      const outputfiles = await clients[availableClient].client.getOutputFiles(
        workflow,
        "video",
        "mp4"
      );
      const outputfile = outputfiles[0];
      const buffer = Buffer.from(await outputfile.blob.arrayBuffer());

      fs.writeFileSync(imagePromptDetail.videoFile, buffer);

      runInAction(() => {
        clients[availableClient].free = true;
      });
    };
    imagesGenerates.push(generateImage());
  }

  await Promise.all(imagesGenerates);
  await Promise.all(clients.map((client) =>
    freeComfyUIMemory(client.client)
  ));
  await Promise.all(clients.map((client) => client.client.disconnect()));
}


async function batchRefineVideoPromptsOllama(imagePromptDetails) {
  console.log("Batch refining video prompts using Ollama");

  const workers = observable([]);
  const maxWorkers = 2; // Number of parallel workers

  // Initialize workers
  for (let i = 0; i < maxWorkers; i++) {
    workers.push({ id: i, free: true });
  }

  const textGenerates = [];

  for (let imagePromptDetail of imagePromptDetails) {
    if (imagePromptDetail.refinedVideoPrompt) continue;

    await when(() => workers.some((worker) => worker.free));
    const availableWorkerIndex = workers.findIndex((worker) => worker.free);
    console.log(`availableWorker: ${availableWorkerIndex}`);

    runInAction(() => {
      workers[availableWorkerIndex].free = false;
    });

    const generateText = async () => {
      console.log(`Refining video prompt for: ${imagePromptDetail.imageFile}`);

      // Read the image and encode it to base64
      const imageBuffer = fs.readFileSync(imagePromptDetail.imageFile);
      const imageBase64 = imageBuffer.toString('base64');

      const promptText = `You are an experienced film concept designer and video generation expert. Based on the given image, conduct a detailed analysis and generate a highly detailed and professional video prompt in JSON format for a 5-second video.
Please strictly adhere to the following JSON structure and content specifications. Each field should be as specific, vivid, and imaginative as possible to capture real-world filmmaking details.
--------------------------------------------------------------------------------
**JSON Structure Template:**
{
  "shot": {
    "composition": "string",
    "camera_motion": "string"
  },
  "subject": {
    "description": "string",
    "wardrobe": "string" // Use "null" if the subject is an animal or has no specific wardrobe
  },
  "scene": {
    "location": "string",
    "time_of_day": "string",
    "environment": "string"
  },
  "visual_details": {
    "action": "string",
    "props": "string", // Use "null" if there are no props
    "action_sequence": "array of objects"
  },
  "cinematography": {
    "lighting": "string",
    "tone": "string"
  }
}
--------------------------------------------------------------------------------
**Content Generation Guidelines (Please keep these principles in mind during generation):**

**1. shot**
*   **composition**: Describe the shot type in detail (e.g., wide shot, medium shot, close-up, long shot), focal length (e.g., 35mm lens, 85mm lens, 50mm lens, 100mm macro telephoto lens, 26mm equivalent lens), camera equipment (e.g., Sony Venice, ARRI Alexa series, RED series, iPhone 15 Pro Max, DJI Inspire 3 drone), and depth of field (e.g., deep depth of field, shallow depth of field).
*   **camera_motion**: Precisely describe how the camera moves (e.g., smooth Steadicam arc, slow lateral dolly, static, handheld shake, slow pan, drone orbit, rising crane).

**2. subject**
*   **description**: Provide an extremely detailed depiction of the subject, including their age (e.g., 25-year-old, 23-year-old, 40-year-old, 92-year-old), gender, ethnicity (e.g., Chinese female, Egyptian female, K-pop artist, European female, East Asian female, African male, Korean female, German female, Italian female, Japanese), body type (e.g., slender and athletic), hair (color, style), and any unique facial features. For non-human subjects (e.g., beluga whale, phoenix, emu, golden eagle, duck, snail), describe their physical characteristics in detail.

**3. scene**
*   **location**: Specify the exact shooting location.
*   **time_of_day**: State the specific time of day (e.g., dawn, early morning, morning, midday, afternoon, dusk, night).
*   **environment**: Provide a detailed environmental description that captures the atmosphere and background details.

**4. visual_details**
*   **action**: A general summary of the action depicted in the video.
*   **action_sequence**: To enhance the visual tension of the generated 5s video, analyze the image and expand upon it creatively. Design a key action for each second, using the format "0-1s: subject + action" to briefly and precisely describe the action occurring in that second.
*   **props**: List all relevant props and elements in the scene (e.g., silver-hilted sword, campfire, candelabra, matcha latte and cheesecake, futuristic motorcycle). If there are no props in the scene, this field should be explicitly set to "null".

**5. cinematography**
*   **lighting**: Describe the light source, quality, color, and direction in detail (e.g., natural dawn light softened by fog, campfire as the key light, natural sunlight through stained glass windows, soft HDR reflections, warm tungsten light and natural window light).
*   **tone**: Capture the abstract emotional or stylistic feel of the video (e.g., "fierce, elegant, fluid", "mystical, elegant, enchanting", "hyperrealistic with an ironic, dark comedic twist", "dreamy, serene, emotionally healing", "documentary realism", "epic, majestic, awe-inspiring", "wild, dynamic, uninhibited").

--------------------------------------------------------------------------------
**Additional Considerations for Prompt Generation:**
*   **Length and formatting**: make sure it is less than 2000 tokens. Make it compact and avoid unnecessary white spaces such as spaces and new lines.
*   **Granularity of Detail**: The LLM should understand that every field requires as much specific detail as possible, not generalizations. For example, instead of writing "a woman," write "a 25-year-old Chinese female with long black hair tied back with a silk ribbon, a slender build, wearing a flowing, pale blue Hanfu...".
*   **Consistency and Diversity**: While the JSON structure must be strictly consistent, the content of each video prompt should be creative and diverse, reflecting the unique elements of different video types (e.g., martial arts, dance, drama, nature documentary, sci-fi action, motivational, commercial, fantasy).
*   **Handling Null Values**: When a field is not applicable (e.g., wardrobe for an animal), the LLM should use "null" rather than an empty string or omitting the field, to maintain the integrity of the JSON structure.
*   **Contextual Description**: When describing action, lighting, and sound, think about how these elements work together to create a specific **"tone"** and express it using vivid language.
*   **Language Requirements**: All output should be clear, concise, and use professional filmmaking terminology.

Context: ${imagePromptDetail.prompt}

Please analyze the image and generate the video prompt following the structure above.`;

      const messages = [
        {
          role: "user",
          content: promptText,
          images: [imageBase64]
        }
      ];

      const message = await generateTextOpenAI(messages, "ollama", "deepseek-r1:32b");
      imagePromptDetail.refinedVideoPrompt = message.content;
      console.log(`Refined video prompt generated for: ${imagePromptDetail.imageFile}`);

      runInAction(() => {
        workers[availableWorkerIndex].free = true;
      });
    };

    textGenerates.push(generateText());
  }

  await Promise.all(textGenerates);
  console.log("All video prompts refined");
}

async function batchGenerateImagesComfyUI(imagePromptDetails) {
  const clients = observable([]);
  const clientId = Math.floor(Math.random() * 4294967294);

  try {
    const serverAddress1 = "127.0.0.1:8188";
    const client1 = new ComfyUIClient(serverAddress1, clientId);
    await client1.connect();
    clients.push({ client: client1, free: true });
  } catch (ex) {
    console.log(ex);
  }

  try {
    const serverAddress2 = "127.0.0.1:8189";
    const client2 = new ComfyUIClient(serverAddress2, clientId);
    await client2.connect();
    clients.push({ client: client2, free: true });
  } catch (ex) {
    console.log(ex);
  }

  const imagesGenerates = [];
  registerExitCallback(async () => {
    clients.forEach(async (client) => {
      await client.client.interrupt();
      await freeComfyUIMemory(client.client);
      await client.client.disconnect();
    });
  });

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

    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/image_qwen_image.json")
    // );

    // workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["6"]["inputs"]["text"] =
    //   imagePromptDetail.style +
    //   ", " +
    //   imagePromptDetail.prompt;
    // workflow["58"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["58"]["inputs"]["height"] = imagePromptDetail.height;
    // workflow["60"]["inputs"]["filename_prefix"] = "image";

    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/image_qwen_10steps.json")
    // );

    // workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["6"]["inputs"]["text"] =
    //   imagePromptDetail.style +
    //   ", " +
    //   imagePromptDetail.prompt;
    // workflow["58"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["58"]["inputs"]["height"] = imagePromptDetail.height;
    // workflow["60"]["inputs"]["filename_prefix"] = "image";

    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/image_qwen_10steps.json")
    // );

    // workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["6"]["inputs"]["text"] =
    //   imagePromptDetail.style +
    //   ", " +
    //   imagePromptDetail.prompt;
    // workflow["58"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["58"]["inputs"]["height"] = imagePromptDetail.height;
    // workflow["60"]["inputs"]["filename_prefix"] = "image";

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

      runInAction(() => {
        clients[availableClient].free = true;
      });
    };
    imagesGenerates.push(generateImage());
  }

  await Promise.all(imagesGenerates);
  await Promise.all(clients.map((client) =>
    freeComfyUIMemory(client.client)
  ));
  await Promise.all(clients.map((client) => client.client.disconnect()));
}

async function generateAudio(text, speakerVoiceFile) {
  const speakerWavBase64 = fs.readFileSync(speakerVoiceFile, {
    encoding: "base64",
  });
  const response = await axios.post(
    `http://localhost:8080/text2speech`,
    {
      text,
      speaker_wav_base64: speakerWavBase64,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  return response.data.data;
}

async function generateTranscript(audioFile) {
  const speechAudioBase64 = fs.readFileSync(audioFile, { encoding: "base64" });
  const response = await axios.post(
    `http://localhost:8080/speech2text`,
    {
      speech_audio_base64: speechAudioBase64,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  return response.data.data;
}

async function generateText(messages) {
  const response = await axios.post(
    `http://localhost:8080/instruct`,
    {
      messages: messages,
      max_new_tokens: 1024,
      do_sample: true,
      temperature: 0.6,
      top_p: 0.9,
      tokenize: false,
      add_generation_prompt: true,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  return response.data.data.message;
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
  //await executeExternalHelper("python generate_image.py", imagePromptDetails);
  await batchGenerateImagesComfyUI(imagePromptDetails);
}

async function batchGenerateVideosByPrompts(imagePromptDetails) {
  console.log("Batch generating videos");
  //await executeExternalHelper("python generate_image.py", imagePromptDetails);
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
  const message = await generateTextOpenAI(messages, "ollama", "deepseek-r1:32b");
  return message.content;
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

  const retry = 30;
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

STRUCTURE (mandatory): [visual_style], [main_subject with FULL appearance], [action], [environment], [lighting], [camera angle], [effects]

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
2. What ACTION is happening
3. WHERE it takes place
4. HOW it's lit and framed
5. WHAT atmosphere/mood

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
        message = await generateTextOpenAI(messages, "ollama", "deepseek-r1:32b");
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
      throw "Error creating story lines";
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

  const retry = 30;
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
    You are an experienced film concept designer and video generation expert. Your task is to generate a highly detailed and professional video prompt in JSON format based on a given theme. This prompt will be used to guide advanced video generation models like Google Veo.
Please strictly adhere to the following JSON structure and content specifications. Each field should be as specific, vivid, and imaginative as possible to capture the details of real-world filmmaking.
--------------------------------------------------------------------------------

{
    "shot": {
      "composition": "string",
        "camera_motion": "string", //make sure use dynamic camera motion
          "frame_rate": "string",
            "film_grain": "string"
      // Optional fields, can be added for more detail:
      // "duration": "string", // e.g., "8s"
      // "resolution": "string", // e.g., "4K HDR"
      // "focus": "string" // e.g., "manual locked on subjects, exposure locked"
    },
    "subject": {
      "description": "string",
        "wardrobe": "string" // Use "null" if the subject is an animal or has no specific clothing
      // Optional fields:
      // "pose": "string",
      // "character_motion": "string",
      // "name": "string", // For multiple subjects
      // "nationality": "string" // For multiple subjects
    },
    "scene": {
      "location": "string",
        "time_of_day": "string",
          "environment": "string"
    },
    "visual_details": {
      "action": "string",
        "props": "string" // Use "null" if there are no props
      // Optional fields:
      // "camera_cut": "string", // e.g., "after the line, camera cuts to client’s reaction"
      // "action_sequence": "array of objects" // For phased actions, e.g., [1]
    },
    "cinematography": {
      "lighting": "string",
        "tone": "string"
    },
    "color_palette": "string"
    // Optional fields:
    // "output": { "quality": "string", "style": "string" }, // e.g., "8K HDR", "TV show quality footage" [2]
    // "visual_rules": { "prohibited_elements": ["array of strings"] } // e.g., "STRICTLY NO on-screen subtitles" [3]
  }

--------------------------------------------------------------------------------
Content Generation Guidelines (Please keep these principles in mind during generation):
1.
shot
◦
composition: Detail the shot type (e.g., wide-angle, medium shot, close-up, long shot), focal length (e.g., 35mm lens, 85mm lens, 50mm lens, 100mm macro telephoto, 26mm equivalent lens), camera equipment (e.g., Sony Venice, ARRI Alexa series, RED series, iPhone 15 Pro Max, DJI Inspire 3 drone), and depth of field (e.g., deep depth of field, shallow depth of field).
◦
camera_motion: Precisely describe how the camera moves, available motion: smooth Steadicam arc, slow lateral track, static, handheld shake, slow pan, drone orbit, rising crane - only use the motions mentioned here
◦
frame_rate: Specify a cinematic standard frame rate (e.g., 24fps), high frame rate (e.g., 30fps, 60fps), or slow-motion frame rate (e.g., 120fps).
◦
film_grain: Describe the type or presence of film grain (e.g., "clean digital, no grain", "Kodak 250D digital emulation with subtle grain overlay", "natural Kodak film grain", "visible 16mm grain").
2.
subject
◦
description: Provide an extremely detailed depiction of the subject, including their age (e.g., 25 years old, 23 years old, 40 years old, 92 years old), gender, ethnicity (e.g., Chinese female, Egyptian female, K-pop artist, European female, East Asian female, African male, Korean female, German female, Italian female, Japanese), body type (e.g., slender and athletic), hair (color, style), and any unique facial features. For non-human subjects (e.g., beluga whale, phoenix, emu, golden eagle, duck, snail), describe their physical characteristics in detail.
◦
wardrobe: Exhaustively describe clothing, accessories, shoes, and makeup, including materials, colors, styles, and any specific details (e.g., light blue Hanfu, gold sequin belly dance costume, tailored charcoal grey suit, Dior streetwear). If the subject is an animal or has no specific clothing, this field should be explicitly set to "null".
3.
scene
◦
location: Precisely specify the shooting location (e.g., misty lake shore, remote desert oasis, interior of a Gothic cathedral, quiet beach, modern gym, urban coffee shop, Japanese izakaya, interior of a train carriage, soccer field, Kowloon Walled City-like alleyway, New Zealand coast).
◦
time_of_day: Specify the time of day (e.g., dawn, early morning, morning, midday, afternoon, dusk, night).
◦
environment: Provide a detailed environmental description, capturing the atmosphere and background details (e.g., low-lying fog, starry sky and bonfire, beams of light from stained glass windows, soft morning mist and ocean waves, sunlit city streets).
4.
visual_details
◦
action: Describe specific, observable, and dynamic actions and event sequences (e.g., a rapid sword-fighting routine, fusion dance, vows and facial transformation, TikTok challenge dance, frustration while putting on socks, a beluga whale leaping out of the water).
◦
props: List all relevant props and elements in the scene (e.g., silver-hilted sword, bonfire, candelabras, matcha latte and cheesecake, futuristic motorcycle). If there are no props in the scene, this field should be explicitly set to "null".
5.
cinematography
◦
lighting: Detail the light sources, quality of light, color, and direction (e.g., natural dawn light softened by fog, bonfire as the primary light source, natural sunlight through stained glass windows, soft HDR reflections, warm tungsten light and natural window light).
◦
tone: Capture the abstract emotional or stylistic quality of the video (e.g., "fierce, elegant, fluid", "mystical, elegant, enchanting", "hyperrealistic with an ironic, dark comedic twist", "dreamy, serene, emotionally healing", "documentary realism", "epic, majestic, awe-inspiring", "wild, dynamic, unrestrained").
6.
color_palette
◦
Describe the dominant colors in the scene in detail, including hues and contrast (e.g., silver-blue, soft whites, and misty greys; rich earthy tones with golden highlights; natural stone greys and warm stained-glass colors; soft yellows, whites, and floral patterns).
--------------------------------------------------------------------------------
Additional Considerations for Prompt Generation:
1.Granularity of Detail: The LLM should understand that every field requires as much specific detail as possible, rather than generalizations. For example, instead of just writing "a woman," write "a 25-year-old Chinese female with long, black hair tied back with a silk ribbon, a slender build, wearing a flowing, light-blue Hanfu...".
2.Consistency and Diversity: While the JSON structure must be strictly consistent, the content of each video prompt should be creative and diverse, reflecting the unique elements of different video genres (e.g., martial arts, dance, drama, nature documentary, sci-fi action, motivational, commercial, fantasy).
3.Contextual Descriptions: When describing action, lighting, and sound effects, think about how these elements work together to create a specific **"tone"** and express it with vivid language.
4.Language Requirements: All output should be clear, concise, and use professional filmmaking terminology.
    The videoPrompt should match the specified genre ${genre} and style: ${style}
     ${characters && characters.length > 0 ? `\n\nMain characters in this story (use these detailed descriptions for subject fields when they appear in scenes):\n${characters.map(c => `- ${c.name}: ${c.appearance}`).join('\n')}\n` : ''}
     ${lastSceneDescriptions.length > 0 ? `Below are the previous ${lastSceneDescriptions.length} scene descriptions for context:
    ***
    ${JSON.stringify(lastSceneDescriptions)}
    ***
    
    ` : ''}

    Below is a sequence of ${sceneDescriptionChunk.length} continuous segments from a story, formatted as a JSON array, with the imagePrompt and sceneDescription:
    ***
    ${JSON.stringify(sceneDescriptionChunk)}
    *** 

    Output the video prompts to capture the essence of the scence described by the sceneDescriptions and imagePrompts according to the above guidelines, using your rich randomness or imagination to create different forms of reference images.
    
    When characters appear, use their detailed appearance descriptions provided above in the subject description field.
    Only include the characters when it is mentioned in the scene description.
    Now output a valid json array containing the video prompts as strings strictly in the structure of [string] and make sure that the length of the output json array same as the input ${sceneDescriptionChunk.length}
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
        console.log(`Attempt #${currentRetry + 1}`);
        const regex = /\[[\s\S]{10,}\]/gm;
        message = await generateTextOpenAI(messages, "ollama", "deepseek-r1:32b");
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);
          console.log(parsed, sceneDescriptionChunk);

          if (
            parsed.length === sceneDescriptionChunk.length
          ) {
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
      throw "Error creating story lines";
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
I will provide you with the story segment by segment. Please:
Separate the narrative from the dialogues.
For dialogues, identify the character who speaks it.
Put all narratives and dialogues in temporal order in JSON format, using the structure: [{"type": "narrative" | "dialog", "content": "text", "character": "name"}].
Ensure that narratives and dialogues are strictly distinguished. Always provide a valid JSON string with proper closing tags.
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
Arrange all narratives and dialogues in temporal order in the JSON format: [{"type": "narrative"|"dialog", "content": "text", "character": "name"}].
Segment: ${contentChunk}

Output: Only provide the raw JSON string without any additional messages or formatting. Ensure the JSON string is valid with proper closing tags.
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
          "ollama", "deepseek-r1:32b");
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
You are an expert character analyst. Extract all main characters from stories and provide extremely detailed visual descriptions suitable for AI image generation.

For each character, provide:
- name: Character's full name
- gender: male/female/other
- appearance: Comprehensive visual description including:
  * Age and age-related features
  * Ethnicity/race and associated features
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

**Keep appearance under 50 words**
Be as specific and visual as possible. If details aren't in the story, infer them logically based on context.
    `,
  };

  const prompt = {
    role: "user",
    content: `
Extract all main characters from the following story. For each character, provide a JSON object with detailed appearance information.

Format: [{"name": "character name", "gender": "male/female/other", "appearance": "extremely detailed visual description suitable for image generation", "voiceType": "voice characteristics"}]

Be extremely specific about appearance. Include:
- Age (e.g., "middle-aged woman in her 40s", "young boy around 8 years old")
- Race/ethnicity (e.g., "East Asian", "African American", "Caucasian with Mediterranean features")
- Facial features (e.g., "sharp angular jawline", "round face with high cheekbones", "almond-shaped green eyes")
- Hair (e.g., "long flowing black hair with slight waves", "short cropped gray hair", "curly red hair in a ponytail")
- Skin (e.g., "pale porcelain skin", "dark brown skin with warm undertones", "olive complexion")
- Body type (e.g., "tall and lean athletic build", "short and stocky", "average height with muscular frame")
- Clothing style (e.g., "elegant Victorian dress in deep purple", "worn leather jacket and jeans", "traditional Japanese kimono")
- Distinctive features (e.g., "scar across left eyebrow", "always wears a silver locket", "crooked smile")

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
      const message = await generateTextOpenAI(messages, "ollama", "deepseek-r1:32b");

      let jsonContent = message.content.trim();

      // Try to extract JSON if wrapped in markdown code blocks
      const jsonMatch = jsonContent.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
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
exports.batchRefineVideoPromptsOllama = batchRefineVideoPromptsOllama;
exports.extractCharactersWithAppearance = extractCharactersWithAppearance;
exports.generateStoryContentByCharactor = generateStoryContentByCharactor;
exports.generateStoryCoverPrompt = generateStoryCoverPrompt;
exports.speedUpAudio = speedUpAudio;
exports.freeVRams = freeVRams;
