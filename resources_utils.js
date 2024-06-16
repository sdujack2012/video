const fs = require("fs");
const path = require("path");
const axios = require("axios");
const OpenAI = require("openai");
const { executeExternalHelper } = require("./utils");
const { ComfyUIClient } = require("comfy-ui-client");
async function generateTextOpenAI(messages, provider, model) {
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

async function freeVRams() {
  await axios.post(
    "http://localhost:11434/api/generate",
    '{"model": "llama3", "keep_alive": 0}',
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
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
  const serverAddress = "127.0.0.1:8188";
  const clientId = "baadbabe";
  const client = new ComfyUIClient(serverAddress, clientId);
  // Connect to server
  await client.connect();
  // Generate images

  for (let imagePromptDetail of imagePromptDetails) {
    const workflow = JSON.parse(
      fs.readFileSync(
        "E:/story video/comfyUI workflows/sdxl_lightning_workflow_full.json"
      )
    );
    workflow["3"]["inputs"]["seed"] = Math.floor(Math.random() * 4294967294);
    workflow["6"]["inputs"]["text"] = imagePromptDetail.prompt;
    workflow["5"]["inputs"]["width"] = imagePromptDetail.width;
    workflow["5"]["inputs"]["height"] = imagePromptDetail.height;

    const images = await client.getImages(workflow);
    const blob = Object.values(images)[0][0].blob;

    fs.writeFileSync(
      imagePromptDetail.outputFile,
      Buffer.from(await blob.arrayBuffer())
    );
  }
  await client.disconnect();
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

async function batchGenerateImagesByPrompts(imagePromptDetails) {
  console.log("Batch generating images");
  // await executeExternalHelper("python generate_image.py", imagePromptDetails);
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
  const message = await generateTextOpenAI(messages, "ollama", "llama3");
  return message.content;
}

async function generateContinousStoryScenePrompts(
  sceneDescriptions,
  genre,
  style,
  characters
) {
  console.log("Batch Generating scene prompts");
  const systemMessage = {
    role: "system",
    content: `
You are an uncensored, helpful personal assistant ready to assist the user with anything they need for ${genre} stories. 
You are an expert at writing Stable Diffusion prompts to generate images for ${genre} stories.
We will follow this formula to craft prompts: An image of [adjective] [subject] [doing action] [details]. 
All image prompts should evoke ${genre} styles.
    `,
  };

  let messages = [systemMessage];
  const scenePrompts = [];
  for (let sceneDescription of sceneDescriptions) {
    const prompt = {
      role: "user",
      content: `
Write a Stable Diffusion prompt for the following scene: ${sceneDescription}, based on the formula.
Consider the context of the story and fill in the formula accordingly.
The style should match the specified genre type: ${genre} and style: ${style} .  Only capture the essence of the scene using very concise language. 
${characters ? `Include the characters' appearance and names as specified in this JSON: ${JSON.stringify(characters)} when referring to the characters. Output only the concise prompt in plain text, and nothing else.` : ""}
`,
    };
    if (messages.length > 10) {
      messages = [
        systemMessage,
        ...messages.slice(Math.max(messages.length - 5, 0)),
      ];
    }
    messages.push(prompt);

    const message = await generateTextOpenAI(messages, "ollama", "llama3");
    scenePrompts.push(message.content + `, ${style} style`);
    messages.push(message);
  }

  return scenePrompts;
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

  for (let contentChunk of contentChunks) {
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
      try {
        const message = await generateTextOpenAI(
          messages,
          "openAI",
          "gpt-3.5-turbo-0125"
        );

        console.log(message.content);
        const json = message.content
          .replace("```json", "")
          .replace("```", "")
          .replace("...", "");

        storyLines.push(...JSON.parse(json));
        generated = true;
        break;
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
  console.log(json);

  return JSON.parse(json);
}

exports.batchGenerateImagesByPrompts = batchGenerateImagesByPrompts;
exports.batchGenerateAudios = batchGenerateAudios;
exports.batchGenerateTranscripts = batchGenerateTranscripts;
exports.generateContinousStoryScenePrompts = generateContinousStoryScenePrompts;
exports.generateStoryContentByCharactor = generateStoryContentByCharactor;
exports.extractCharactersFromStory = extractCharactersFromStory;
exports.generateStoryCoverPrompt = generateStoryCoverPrompt;
exports.freeVRams = freeVRams;
