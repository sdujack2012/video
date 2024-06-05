const fs = require("fs");
const path = require("path");
const axios = require("axios");
const OpenAI = require("openai");
const { executeExternalHelper } = require("./utils");

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

async function generateImage(prompt, width, height) {
  const response = await axios.get(
    `http://localhost:8080/text2image`,
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
  await executeExternalHelper("python generate_image.py", imagePromptDetails);
  // for(let imagePromptDetail of imagePromptDetails) {
  //   const imageBase64 = await generateImage(imagePromptDetail.prompt);
  //   const buff = Buffer.from(imageBase64, 'base64');
  //   fs.writeFileSync(imagePromptDetail.outputFile, buff);
  // }
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
    you are an expert on writing Stable Diffusion prompts to generate images for ${genre} stories. 
    We will follow the formula to craft prompts: An image of [adjective] [subjuct] [doing action] [details] 
    All the image prompts need to suggest ${genre} styles.
    `,
  };

  const prompt = {
    role: "user",
    content: `
    Now write a Stable Diffusion prompt to create a cover image for the following story content "${content}" based on the formula. 
    Please be as specific as possible about the surrounding, the backgroup and the style needs to match the genre type ${genre} 
    Please also include the character's appearance and name specified in this json ${JSON.stringify(characters)} when you refering to the characters
    Please only output the prompt concise in plain text and don't include anything else. 
    `,
  };

  const messages = [systemMessage, prompt];

  messages.push(prompt);
  const message = await generateTextOpenAI(messages, "ollama", "llama3_custom");
  return message.content;
}

async function generateContinousStoryScenePrompts(
  scenceDescriptions,
  genre,
  characters
) {
  console.log("Batch Generating scence prompts");
  const systemMessage = {
    role: "system",
    content: `
    you are an expert on writing Stable Diffusion prompts to generate images for ${genre} stories. 
    We will follow the formula to craft prompts: An image of [adjective] [subjuct] [doing action] [details] 
    All the image prompts need to suggest ${genre} styles.
    `,
  };

  let messages = [systemMessage];
  const scenePrompts = [];

  for (let scenceDescription of scenceDescriptions) {
    const prompt = {
      role: "user",
      content: `
      Now write a Stable Diffusion prompt for the following scene ${scenceDescription} based on the formula. 
      Please consider the context of the story provided and then fill the formula. 
      Please don't include the conversations directly into the prmpt and instead, be as specific as possible about the characters' appearance, what they are doing and the surrounding. The style needs to match the genre type ${genre} 
      Please use very concise lanaguages. 
      Please also include the character's appearance and name specified in this json ${JSON.stringify(characters)} when you refering to the characters
      Please only output the prompt concise in plain text and don't include anything else. 
      `,
    };
    if (messages.length > 5) {
      messages = [systemMessage];
    }
    messages.push(prompt);
    // const message = await generateText(messages);

    const message = await generateTextOpenAI(
      messages,
      "ollama",
      "llama3_custom"
    );

    messages.push(message);
    console.log(message);
    scenePrompts.push(message.content);
  }

  return scenePrompts;
}

async function generateStoryContentByCharactor(content, characters) {
  console.log("Generating story lines");
  const systemMessage = {
    role: "system",
    content: `
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
