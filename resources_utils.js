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
      '{"model": "mannix/llama3-sppo-iter3:q8_0", "keep_alive": 0}',
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
  } catch (ex) {}
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

async function batchGenerateImagesComfyUI(imagePromptDetails) {
  const serverAddress1 = "127.0.0.1:8188";
  const clientId = Math.floor(Math.random() * 4294967294);
  const client1 = new ComfyUIClient(serverAddress1, clientId);

  const serverAddress2 = "127.0.0.1:8189";
  const client2 = new ComfyUIClient(serverAddress2, clientId);
  // Connect to server
  await client1.connect();
  await client2.connect();
  // Generate images
  let clients = observable([
    { client: client1, free: true },
    { client: client2, free: true },
  ]);
  const imagesGenerates = [];
  registerExitCallback(async () => {
    await client2.interrupt();
    await client1.interrupt();
    await client1.disconnect();
    await client2.disconnect();
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
    //   fs.readFileSync(
    //     "E:/story video/comfyUI workflows/sdxl_lightning_workflow_full.json"
    //   )
    // );
    // workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["6"]["inputs"]["text"] =
    //   "master piece, digital art" + imagePromptDetail.prompt;
    // workflow["5"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["5"]["inputs"]["height"] = imagePromptDetail.height;

    // const workflow = JSON.parse(
    //   fs.readFileSync(
    //     "E:/story video/comfyUI workflows/workflow_txt_to_image.json"
    //   )
    // );
    // workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["17"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    // workflow["18"]["inputs"]["text"] =
    //   "digital art, master piece, 8k" + imagePromptDetail.prompt;
    // workflow["22"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["22"]["inputs"]["height"] = imagePromptDetail.height;
    // workflow["12"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["12"]["inputs"]["height"] = imagePromptDetail.height;
    // const workflow = JSON.parse(
    //   fs.readFileSync("E:/story video/comfyUI workflows/sdxl_refiner.json")
    // );
    // workflow["10"]["inputs"]["noise_seed"] = Math.floor(
    //   Math.random() * 4294967294
    // );
    // workflow["6"]["inputs"]["text"] =
    //   "master piece, 8k" + imagePromptDetail.prompt;
    // workflow["5"]["inputs"]["width"] = imagePromptDetail.width;
    // workflow["5"]["inputs"]["height"] = imagePromptDetail.height;

    const workflow = JSON.parse(
      fs.readFileSync("E:/story video/comfyUI workflows/sd3.json")
    );
    workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    workflow["6"]["inputs"]["text"] = imagePromptDetail.prompt + "master piece";
    workflow["5"]["inputs"]["width"] = imagePromptDetail.width;
    workflow["5"]["inputs"]["height"] = imagePromptDetail.height;
    const generateImage = async () => {
      const images = await clients[availableClient].client.getImages(
        workflow,
        null,
        "png"
      );
      const blob = images[0].blob;
      fs.writeFileSync(
        imagePromptDetail.imageFile,
        Buffer.from(await blob.arrayBuffer())
      );
      runInAction(() => {
        clients[availableClient].free = true;
      });
    };
    imagesGenerates.push(generateImage());
  }

  await Promise.all(imagesGenerates);
  imagesGenerates.length = 0;

  for (let imagePromptDetail of imagePromptDetails) {
    if (
      !imagePromptDetail.videoFile ||
      fs.existsSync(imagePromptDetail.videoFile)
    ) {
      continue;
    }
    await when(() => clients.some((clientConfig) => clientConfig.free));
    const availableClient = clients.findIndex(
      (clientConfig) => clientConfig.free
    );

    runInAction(() => {
      clients[availableClient].free = false;
    });

    // const workflowImg2Vid = JSON.parse(
    //   fs.readFileSync(
    //     "E:/story video/comfyUI workflows/workflow_img2vid_animationdiff.json"
    //   )
    // );
    // workflowImg2Vid["10"]["inputs"]["seed"] = Math.floor(
    //   Math.random() * 4294967294
    // );
    // workflowImg2Vid["374"]["inputs"]["text"] =
    //   imagePromptDetail.prompt + "master piece";

    // workflowImg2Vid["63"]["inputs"]["image"] = imagePromptDetail.imageFile;
    // workflowImg2Vid["116"]["inputs"]["int"] = imagePromptDetail.width / 2;
    // workflowImg2Vid["117"]["inputs"]["int"] = imagePromptDetail.height / 2;
    // workflowImg2Vid["573"]["inputs"]["width"] = imagePromptDetail.width;
    // workflowImg2Vid["573"]["inputs"]["height"] = imagePromptDetail.height;
    // workflowImg2Vid["369"]["inputs"]["filename_prefix"] = "video_gif";

    const workflowImg2Vid = JSON.parse(
      fs.readFileSync("E:/story video/comfyUI workflows/workflow_img2vid.json")
    );
    workflowImg2Vid["3"]["inputs"]["seed"] = Math.floor(
      Math.random() * 4294967294
    );
    workflowImg2Vid["23"]["inputs"]["image"] = imagePromptDetail.imageFile;
    workflowImg2Vid["12"]["inputs"]["width"] = imagePromptDetail.width / 2;
    workflowImg2Vid["12"]["inputs"]["height"] = imagePromptDetail.height / 2;
    workflowImg2Vid["32"]["inputs"]["width"] = imagePromptDetail.width;
    workflowImg2Vid["32"]["inputs"]["height"] = imagePromptDetail.height;
    workflowImg2Vid["30"]["inputs"]["filename_prefix"] = "video_gif";

    const generateVideo = async () => {
      const images = await clients[availableClient].client.getImages(
        workflowImg2Vid,
        "video_gif",
        "mp4"
      );
      const blob = images[0].blob;
      fs.writeFileSync(
        imagePromptDetail.videoFile,
        Buffer.from(await blob.arrayBuffer())
      );

      runInAction(() => {
        clients[availableClient].free = true;
      });
    };
    imagesGenerates.push(generateVideo());
  }
  await Promise.all(imagesGenerates);
  await client1.disconnect();
  await client2.disconnect();
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

async function batchGenerateAudios(audioDetails) {
  console.log("Batch generating audios");
  await executeExternalHelper("python generate_audio.py", audioDetails);
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

async function generateStoryCoverPrompt(content, genre, characters) {
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
Please write a Stable Diffusion prompt to create a cover image for the following story content: "${content}". The prompt should be detailed, specifying the surroundings, background, and style to match the genre type: ${genre}. Include the characters' appearance and names as specified in this JSON: ${JSON.stringify(characters)}. The output should be concise, in plain text, and contain only the prompt.
    `,
  };

  const messages = [systemMessage, prompt];

  messages.push(prompt);
  const message = await generateTextOpenAI(messages, "ollama", "yi:34b");
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
    `image_prompts_cache_${splitLimit}.json`
  );

  const cache = fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, "utf8"))
    : null;

  const scenePrompts = cache ? cache.scenePrompts : [];
  let index = cache ? cache.index + 1 : 0;
  let messages = cache ? cache.messages : [];

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
    const promptText =
      sceneDescriptions.length < 10
        ? `
    Below is a sequence of ${sceneDescriptionChunk.leng} continuous segments from a story, formatted as a JSON array, with the imagePrompt field currently empty:
    ***
    ${JSON.stringify(sceneDescriptionChunk.map((sceneDescription) => ({ segment: sceneDescription, imagePrompt: null })))}
    *** 
    Create image prompts to capture the essence of the scence described by the segment 
    The image prompts must follow this formula: An image of subject, adjective, doing action, additional details
    The image prompts must be as detailed as possibile. 
    The image description should match the specified genre ${genre} and style: ${style}.
    ${characters ? `Include the characters' appearance and names as specified in this JSON: ${JSON.stringify(characters)} when referring to the characters. ` : ""}
    Now output a valid raw json in the format of [{segment: string, imagePrompt: string}] and make sure that:
    1. Keep the segemnt content untouched and original. Don't change the spellings
    2. Don't split or merge the segemnts
    3. Make the length of the output json array same as the input
    `
        : `
    Below are segments from a story separated by linebreaks. Split them into about ${sceneDescriptionChunk.length} smaller and complete segments and create image prompt(usering the formular: An image of adjective, subject, doing action, additional details) to capture the essence of the scence for each of the segments
    ***
    ${sceneDescriptionChunk.join("\n")}
    ***
    The image prompt should follow the following formula: An image of adjective, subject, doing action, additional details. 
    The image prompt should be as detailed as possibile and should be as detailed as possibile
    The image prompt should consider the context of other segements. 
    The image description should match the specified genre ${genre} and style: ${style}.
    ${characters ? `Include the characters' appearance and names as specified in this JSON: ${JSON.stringify(characters)} when referring to the characters. ` : ""}
    Now output a valid raw json in the format of [{segment: string, imagePrompt: string}] and make sure that:
    1. Keep the segemnt content untouched. Don't change the spellings
    2. Don't split or merge the segemnts
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
        message = await generateTextOpenAI(
          messages,
          "ollama",
          "llama3:8b-instruct-fp16"
        );
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);
          console.log(parsed, sceneDescriptionChunk);
          const storyUntouched =
            sceneDescriptions.length < 10
              ? sceneDescriptionChunk.length === parsed.length &&
                sceneDescriptionChunk.every((sceneDescription, index) =>
                  stringSimilarity(sceneDescription, parsed[index].segment)
                ) > 0.8
              : stringSimilarity(
                  sceneDescriptionChunk.join("\n"),
                  parsed.map((object) => object.segment).join("\n")
                ) > 0.8;

          if (
            storyUntouched &&
            parsed.every((object) => object.segment && object.imagePrompt)
          ) {
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
  fs.unlinkSync(cacheFile);
  return await refineImagePrompts(
    scenePrompts.map((scenePrompt) => ({
      content: scenePrompt.segment,
      sceneImagePrompt: scenePrompt.imagePrompt,
    }))
  );
}

async function refineImagePrompts(
  contentImagePrompts,
  genre,
  style,
  characters
) {
  console.log("Refine scene prompts");
  const refinedPrompts = [];
  let messages = [];

  const retry = 30;
  //const message = await generateText(messages);
  for (let index = 0; index < contentImagePrompts.length; index++) {
    console.log(
      `##############Refine scene prompts for contentImagePrompts ${index + 1}/${contentImagePrompts.length}`
    );
    const contentImagePrompt = contentImagePrompts[index];

    const promptText = `
    Below is a a segmentsfrom a story, formatted as a JSON object, with the sceneImagePrompt describing the scence for the segment 
    ***
    ${JSON.stringify(contentImagePrompt)}
    ***
    Please refine the sceneImagePrompt so that it follows closely the content of the segment. Below are the guidelines:
    1. sceneImagePrompt must follow the following formula: An image of adjective, subject, doing action, additional details. 
    1. sceneImagePrompt must describe the scence as detailed and consistent as possible
    2. sceneImagePrompt must consider the context of the closest segments provided in the previous messages
    3. The sceneImagePrompt must match the specified genre ${genre} and style: ${style} if possible.
    ${characters ? `3. Include the characters' appearance and names as specified in this JSON: ${JSON.stringify(characters)} when referring to the characters. ` : ""}
    Now output a valid raw json in the format of {content: string, sceneImagePrompt: string} and make sure that:
    1. Keep the segemnt content untouched
    2. Don't split or merge the segemnts
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
        message = await generateTextOpenAI(
          messages,
          "ollama",
          "llama3:8b-instruct-fp16"
        );
        const matches = message.content.match(regex);
        if (matches && matches.length > 0) {
          const parsed = JSON.parse(matches[0]);
          const storyUntouched =
            stringSimilarity(contentImagePrompt.content, parsed.content) > 0.9;

          if (storyUntouched && parsed.sceneImagePrompt) {
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
        const message = await generateTextOpenAI(messages, "ollama", "llama3");
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

  const message = await generateTextOpenAI(messages, "openAI", "gpt-4o");

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
exports.batchGenerateAudios = batchGenerateAudios;
exports.batchGenerateTranscripts = batchGenerateTranscripts;
exports.generateContinousStoryScenePrompts = generateContinousStoryScenePrompts;
exports.generateStoryContentByCharactor = generateStoryContentByCharactor;
exports.extractCharactersFromStory = extractCharactersFromStory;
exports.generateStoryCoverPrompt = generateStoryCoverPrompt;
exports.speedUpAudio = speedUpAudio;
exports.freeVRams = freeVRams;
