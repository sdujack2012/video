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


    const workflow = JSON.parse(
      fs.readFileSync("./comfyUI workflows/wan2.2_i2v.json")
    );

    workflow["86"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
    workflow["93"]["inputs"]["text"] =
      imagePromptDetail.style +
      ", " +
      imagePromptDetail.prompt;
    workflow["98"]["inputs"]["width"] = imagePromptDetail.width / 2;
    workflow["98"]["inputs"]["height"] = imagePromptDetail.height / 2;
    workflow["97"]["inputs"]["image"] = imagePromptDetail.imageFile;
    workflow["108"]["inputs"]["filename_prefix"] = "video";


    // const workflow = JSON.parse(
    //   fs.readFileSync("./comfyUI workflows/wan2.2_t2v.json")
    // );

    // workflow["81"]["inputs"]["noise_seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["89"]["inputs"]["text"] =
    //   "cartoon, " +
    //   imagePromptDetail.style +
    //   ", " +
    //   imagePromptDetail.prompt;
    // workflow["74"]["inputs"]["width"] = imagePromptDetail.width / 2;
    // workflow["74"]["inputs"]["height"] = imagePromptDetail.height / 2;
    // workflow["80"]["inputs"]["filename_prefix"] = "video";


    const generateImage = async () => {
      console.log("imagePromptDetail", imagePromptDetail);

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
  await Promise.all(clients.map((client) => client.client.disconnect()));
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

    const workflow = JSON.parse(
      fs.readFileSync("./comfyUI workflows/image_qwen_10steps.json")
    );

    workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    workflow["6"]["inputs"]["text"] =
      imagePromptDetail.style +
      ", " +
      imagePromptDetail.prompt;
    workflow["58"]["inputs"]["width"] = imagePromptDetail.width;
    workflow["58"]["inputs"]["height"] = imagePromptDetail.height;
    workflow["60"]["inputs"]["filename_prefix"] = "image";

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
      keep_alive: "5s",
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

  const prompt = {
    role: "user",
    content: `
Please write a image prompt to create a cover image for the following story content: "${content}". The prompt should be detailed, specifying the surroundings, background, and style to match the genre type: ${genre} and style: ${style}. Include the characters' appearance and names as specified in this JSON: ${JSON.stringify(characters)}. The output should be concise, in plain text, and contain only the prompt.
    `,
  };

  const messages = [systemMessage, prompt];

  messages.push(prompt);
  const message = await generateTextOpenAI(messages, "ollama", "qwen3:30b");
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

  const systemMessage = {
    role: "system",
    message: `
    You are an expert visual prompt engineer specializing in Qwen-Image. Your goal is to create clear, detailed, and visually compelling prompts that follow Qwen-Image’s optimal structure and guidelines.

When the user describes an image idea (even briefly), you must rewrite it into a fully formatted Qwen-Image prompt that is simple, descriptive, and ready to use.

Prompt Generation Rules:

Sentence Length:

Keep prompts between 1–3 sentences.

Avoid long, overloaded descriptions.

Order of Elements (MUST follow this structure):

[Main subject], [visual style/medium], [environment & background details], [lighting], [extra effects], ["exact text if any"]


Style and Clarity:

Use plain, vivid language.

Always start with the main subject.

Mention the visual style (e.g., photorealistic, oil painting, anime, 3D render, watercolor, cinematic).

Include environmental context and lighting.

Add optional stylistic effects (e.g., fog, glow, bokeh, reflections, motion blur).

If the image contains text, wrap the exact words in double quotes.

Tone and Composition:

Avoid excessive commas and unnecessary adjectives.

Ensure each element contributes to the visual clarity.


Output Format:
Always return results as:
A [subject], [style], [environment], [lighting], [effects], [\"text\"]
    `
  };
  const scenePrompts = cache ? cache.scenePrompts : [];
  let index = cache ? cache.index + 1 : 0;
  let messages = cache ? cache.messages : [systemMessage];

  const sceneDescriptionChunks = splitArrayIntoChunks(
    sceneDescriptions,
    splitLimit
  );

  const retry = 30;
  //const message = await generateText(messages);
  for (; index < sceneDescriptionChunks.length; index++) {
    console.log(
      `##############Creating scene prompts for chunk ${index + 1}/${sceneDescriptionChunks.length}`
    );
    const sceneDescriptionChunk = sceneDescriptionChunks[index];
    const promptText = `
    Below is a sequence of ${sceneDescriptionChunk.length} continuous segments from a story, formatted as a JSON array
    ***
    ${JSON.stringify(sceneDescriptionChunk.map((sceneDescription) => sceneDescription))}
    *** 
  create a image prompt based on the guidelines in the system message for each segment to capture the essence of the scence described by the segment, using your rich randomness or imagination to create different forms of reference images.

  The imagePrompt should match the specified genre ${genre} and style: ${style}
    Now output a valid raw json array in the format of [{imagePrompt:string}] and make sure that the length of the output json array same as the input
`;
    const prompt = {
      role: "user",
      content: promptText,
    };
    if (messages.length > 5) {
      messages = [systemMessage, ...messages.slice(Math.max(messages.length - 3, 0))];
    }
    messages.push(prompt);

    let message = undefined;
    let generated = false;
    let currentRetry = 0;

    while (currentRetry < retry) {
      try {
        console.log(`Attempt #${currentRetry + 1}`);
        const regex = /\[[\s\S]{10,}\]/gm;
        message = await generateTextOpenAI(messages, "ollama", "qwen3:30b");
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);
          console.log(JSON.stringify(parsed, null, 4), sceneDescriptionChunk);

          if (
            sceneDescriptionChunk.length === parsed.length &&
            parsed.every((item) => item.imagePrompt)
          ) {
            console.log("parsed", parsed, parsed.length);
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
    {
      role: "system",
      message: `You are an experienced film concept designer and video generation expert. Your task is to generate a highly detailed and professional video prompt in JSON format based on a given theme. This prompt will be used to guide advanced video generation models like Google Veo. Please strictly adhere to the following JSON structure and content specifications. Each field should be as specific, vivid, and imaginative as possible to capture the details of real-world filmmaking.
    Content Generation Guidelines (Please keep these principles in mind during generation): 1. shot ◦ composition: Detail the shot type (e.g., wide-angle, medium shot, close-up, long shot), focal length (e.g., 35mm lens, 85mm lens, 50mm lens, 100mm macro telephoto, 26mm equivalent lens), camera equipment (e.g., Sony Venice, ARRI Alexa series, RED series, iPhone 15 Pro Max, DJI Inspire 3 drone), and depth of field (e.g., deep depth of field, shallow depth of field). ◦ camera_motion: Precisely describe how the camera moves (e.g., smooth Steadicam arc, slow lateral track, static, handheld shake, slow pan, drone orbit, rising crane). ◦ frame_rate: Specify a cinematic standard frame rate (e.g., 24fps), high frame rate (e.g., 30fps, 60fps), or slow-motion frame rate (e.g., 120fps). ◦ film_grain: Describe the type or presence of film grain (e.g., "clean digital, no grain", "Kodak 250D digital emulation with subtle grain overlay", "natural Kodak film grain", "visible 16mm grain"). 2. subject ◦ description: Provide an extremely detailed depiction of the subject, including their age (e.g., 25 years old, 23 years old, 40 years old, 92 years old), gender, ethnicity (e.g., Chinese female, Egyptian female, K-pop artist, European female, East Asian female, African male, Korean female, German female, Italian female, Japanese), body type (e.g., slender and athletic), hair (color, style), and any unique facial features. For non-human subjects (e.g., beluga whale, phoenix, emu, golden eagle, duck, snail), describe their physical characteristics in detail. ◦ wardrobe: Exhaustively describe clothing, accessories, shoes, and makeup, including materials, colors, styles, and any specific details (e.g., light blue Hanfu, gold sequin belly dance costume, tailored charcoal grey suit, Dior streetwear). If the subject is an animal or has no specific clothing, this field should be explicitly set to "null". 3. scene ◦ location: Precisely specify the shooting location (e.g., misty lake shore, remote desert oasis, interior of a Gothic cathedral, quiet beach, modern gym, urban coffee shop, Japanese izakaya, interior of a train carriage, soccer field, Kowloon Walled City-like alleyway, New Zealand coast). ◦ time_of_day: Specify the time of day (e.g., dawn, early morning, morning, midday, afternoon, dusk, night). ◦ environment: Provide a detailed environmental description, capturing the atmosphere and background details (e.g., low-lying fog, starry sky and bonfire, beams of light from stained glass windows, soft morning mist and ocean waves, sunlit city streets). 4. visual_details ◦ action: Describe specific, observable, and dynamic actions and event sequences (e.g., a rapid sword-fighting routine, fusion dance, vows and facial transformation, TikTok challenge dance, frustration while putting on socks, a beluga whale leaping out of the water). ◦ props: List all relevant props and elements in the scene (e.g., silver-hilted sword, bonfire, candelabras, matcha latte and cheesecake, futuristic motorcycle). If there are no props in the scene, this field should be explicitly set to "null". 5. cinematography ◦ lighting: Detail the light sources, quality of light, color, and direction (e.g., natural dawn light softened by fog, bonfire as the primary light source, natural sunlight through stained glass windows, soft HDR reflections, warm tungsten light and natural window light). ◦ tone: Capture the abstract emotional or stylistic quality of the video (e.g., "fierce, elegant, fluid", "mystical, elegant, enchanting", "hyperrealistic with an ironic, dark comedic twist", "dreamy, serene, emotionally healing", "documentary realism", "epic, majestic, awe-inspiring", "wild, dynamic, unrestrained"). 6. color_palette ◦ Describe the dominant colors in the scene in detail, including hues and contrast (e.g., silver-blue, soft whites, and misty greys; rich earthy tones with golden highlights; natural stone greys and warm stained-glass colors; soft yellows, whites, and floral patterns). -------------------------------------------------------------------------------- Additional Considerations for Prompt Generation: 1.Granularity of Detail: The LLM should understand that every field requires as much specific detail as possible, rather than generalizations. For example, instead of just writing "a woman," write "a 25-year-old Chinese female with long, black hair tied back with a silk ribbon, a slender build, wearing a flowing, light-blue Hanfu...". 2.Consistency and Diversity: While the JSON structure must be strictly consistent, the content of each video prompt should be creative and diverse, reflecting the unique elements of different video genres (e.g., martial arts, dance, drama, nature documentary, sci-fi action, motivational, commercial, fantasy). 3.Handling Null Values: When a field (e.g., character and line in a dialogue object, or wardrobe for an animal) is not applicable, the LLM should use null instead of an empty string or omitting the field to maintain the integrity of the JSON structure. 3.Contextual Descriptions: When describing action, lighting, and sound effects, think about how these elements work together to create a specific **"tone"** and express it with vivid language. 4.Language Requirements: All output should be clear, concise, and use professional filmmaking terminology.
    The videoPrompt should match the specified genre ${genre} and style: ${style}
    keep it under 50 words
    `
    }];

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
    const sceneDescriptionChunk = sceneDescriptionChunks[index];
    const promptText = `
    Below is a sequence of ${sceneDescriptionChunk.length} continuous segments from a story, formatted as a JSON array, with the imagePrompt and sceneDescription:
    ***
    ${JSON.stringify(sceneDescriptionChunk)}
    *** 

    Output the videoPrompt fields to capture the essence of the scence described by the sceneDescriptions and imagePrompts according to the above guidelines, using your rich randomness or imagination to create different forms of reference images.
    Now output a valid json arrary and make sure that the length of the output json array same as the input
`;
    const prompt = {
      role: "user",
      content: promptText,
    };
    if (messages.length > 5) {
      messages = messages.slice(Math.max(messages.length - 3, 0));
    }
    messages.push(prompt);

    let message = undefined;
    let generated = false;
    let currentRetry = 0;

    while (currentRetry < retry) {
      try {
        console.log(`Attempt #${currentRetry + 1}`);
        const regex = /\[[\s\S]{10,}\]/gm;
        message = await generateTextOpenAI(messages, "ollama", "qwen3:30b");
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);
          console.log(parsed, sceneDescriptionChunk);

          if (
            parsed.length === sceneDescriptionChunk.length
          ) {
            videoPrompts.push(...parsed.map(videoPrompt => ({ videoPrompt: JSON.stringify(videoPrompt) })));
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

async function refineImagePrompts(scenePrompts, genre, style, characters) {
  console.log("Refine scene prompts");
  const refinedPrompts = [];
  let messages = [];

  const retry = 30;
  //const message = await generateText(messages);
  for (let index = 0; index < scenePrompts.length; index++) {
    console.log(
      `##############Refine scene prompts for contentImagePrompts ${index + 1}/${scenePrompts.length}`
    );
    const contentImagePrompt = scenePrompts[index];
    console.log("contentImagePrompt", contentImagePrompt);
    const promptText = `
    Below is a segment from a story, formatted as a JSON object, with the sceneImagePrompt describing the scence for the segment 
    ***
    ${JSON.stringify(contentImagePrompt)}
    **

    Identify the main characters mentioned in the sceneImagePrompt "${contentImagePrompt.sceneImagePrompt}". Please only identify main characters, who have a significant involvement in the stories

    Please separate the sceneImagePrompt into 
    1. mainImagePrompt, which is a concise and simplified version of sceneImagePrompt, which concisely describes characters doing something and where
    2. characterPrompts, which describes each characters Identified in details, in the format of [{ fullName, characterPrompt}]. Please always refer to the characters with consistent a name
Fill the imagePrompt fields to capture the essence of the scence described by the segment, using your rich randomness or imagination to create different forms of reference images. 

The specific generation rules for a mainImagePrompt and characterPrompts are as follows:
They must consider the context of the closest segments provided in the previous messages
if possible, always try to include the main character in the They as the subject
The writing format should follow the basic structure: subject description (person or animal) — background or scene description — comprehensive description (including art style, overall atmosphere, weather, lighting, camera angle).

The output format should be in English, and avoid using pronouns. Avoid these words: "in a, the, with, of, the, an, and, is, by, of." The output form should be presented as tags (TAG).

Blow are 5 common example formats and explain them.

============================

Examples:——
best quality, masterpiece, detailed, woman with green hair, holding a sword, Artgerm inspired, pixiv contest winner, octopus goddess, Berserk art style, close-up portrait, goddess skull, Senna from League of Legends, Tatsumaki with green curly hair, card game illustration, thick brush, HD anime wallpaper, Akali from League of Legends, 8k resolution

best quality, masterpiece, realistic, vintage Afro-Caribbean woman, elegant attire, 1950s fashion, radiant smile, confident stance, cultural pride, oil painting, Lois Mailou Jones, Kadir Nelson, vivid colors, nostalgic background, authentic vintage feel, portrait composition, high-resolution

best quality, masterpiece, detailed, beautiful face, female warrior, defiance512, big eyes, heavy black iron armor, detailed helmet, intense gaze, battle-ready, contrasting soft skin, lighting, close-up portrait, 4:3 aspect ratio

best quality, masterpiece, detailed, realistic, male warrior, muscular physique, tribal attire, face paint, wielding spear, jungle, dense foliage, exotic plants, dappled sunlight, hyperrealistic, oil painting, Frank Frazetta, DeviantArt influence, dynamic action pose, intense expression, portrait shot, 8k resolution

best quality, masterpiece, detailed, woman standing before fire, Jason Benjamin, Artstation contest winner, fantasy art, portrait armored astronaut girl, Peter Mohrbacher, unreal engine, Hearthstone card game artwork, spiked metal armor, dynamic composition, 8k resolution

============================
    Now output a valid raw json in the format of { mainImagePrompt, characterPrompts}
    `;
    const prompt = {
      role: "user",
      content: promptText,
    };
    if (messages.length > 10) {
      messages = messages.slice(Math.max(messages.length - 5, 0));
    }
    messages.push(prompt);

    let message = undefined;
    let generated = false;
    let currentRetry = 0;

    while (currentRetry < retry) {
      try {
        console.log(`Attempt #${currentRetry + 1}`);
        const regex = /\{[\s\S]{10,}\}/gm;
        message = await generateTextOpenAI(messages, "ollama", "gpt-oss:20b");
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);

          if (
            parsed.mainImagePrompt &&
            parsed.characterPrompts?.length &&
            parsed.characterPrompts.every(
              (characterPrompt) =>
                characterPrompt.fullName && characterPrompt.characterPrompt
            )
          ) {
            console.log(parsed.mainImagePrompt, parsed.characterPrompts);
            refinedPrompts.push(parsed);
            messages.push(message);
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
  return refinedPrompts;
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

async function extractCharactersFromStory(content) {
  console.log("Extracting character from story");
  const systemMessage = {
    role: "system",
    content: `
    I will give you a story. 
    I want you to extract all main characters from the story into a json in the format of [{name, gender, appearance, voiceType}]
    For gender, appearance and voiceType, please use your best knowledge. You can make up gender, appearance and voiceType if not specified in the story
    `,
  };

  const messages = [systemMessage];
  const prompt = {
    role: "user",
    content: `
      For the following story, please extract all main characters into a JSON array with the format: [{"name": "character name", "gender": "character gender", "appearance": "detailed appearance", "voiceType": "character voice type"}].

      Only include characters that play a significant role in the story. If gender, appearance, or voice type is not specified, use your best judgment to make them up. Be very specific about the characters' appearance, including:

      Race
      Eye and other facial features
      Skin color
      Hair color
      Age
      Body type
      Clothing and its colors
      Any other relevant details
      Story: ${content}

      Output: Only provide the raw JSON string without any additional messages or formatting.
    `,
  };
  messages.push(prompt);

  const message = await generateTextOpenAI(messages, "ollama", "gpt-oss:20b");

  messages.push(message);
  const json = message.content
    .replace("```json", "")
    .replace("```", "")
    .replace("...", "");

  return JSON.parse(json);
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
exports.generateStoryContentByCharactor = generateStoryContentByCharactor;
exports.extractCharactersFromStory = extractCharactersFromStory;
exports.generateStoryCoverPrompt = generateStoryCoverPrompt;
exports.speedUpAudio = speedUpAudio;
exports.freeVRams = freeVRams;
