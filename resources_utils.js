const fs = require("fs");
const axios = require("axios");
const OpenAI = require("openai");
const apiKey = fs.readFileSync("./apikey", "utf8");
const openai = new OpenAI({ apiKey });

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

async function batchGenerateImagesByPrompts(imagePromptDetails) {
  console.log("Batch generating images");
  for (let imagePromptDetail of imagePromptDetails) {
    const imageBase64 = await generateImage(
      imagePromptDetail.prompt,
      imagePromptDetail.width,
      imagePromptDetail.height
    );
    fs.writeFileSync(
      imagePromptDetail.outputFile,
      Buffer.from(imageBase64, "base64")
    );
  }
}

async function batchGenerateAudios(audioDetails) {
  console.log("Batch generating audios");
  for (let audioDetail of audioDetails) {
    const audioBase64 = await generateAudio(
      audioDetail.text,
      audioDetail.speakerVoiceFile
    );
    fs.writeFileSync(
      audioDetail.outputFile,
      Buffer.from(audioBase64, "base64")
    );
  }
}

function mergeTranscriptSegments(segments, segmentLength = 10) {
  let index = 0;
  const mergedsegments = [];
  while (index < segments.length) {
    let startIndex = index;
    index++;
    while (
      index < segments.length - 1 &&
      segments[index].end - segments[startIndex].start < segmentLength
    ) {
      index++;
    }
    const selectedSegments = segments.slice(startIndex, index + 1);
    const selectedText = selectedSegments
      .map((segment) => segment.text)
      .join("");
    const selectedwords = selectedSegments
      .map((segment) => segment.words)
      .flatMap((words) => words);

    mergedsegments.push({
      start: segments[startIndex].start,
      end: segments[index > segments.length - 1 ? segments.length - 1 : index]
        .end,
      text: selectedText,
      words: selectedwords,
    });
    index++;
  }
  return mergedsegments;
}

async function batchGenerateTranscripts(audioFiles, segmentLength) {
  console.log("Batch Generating transcripts");
  const transcripts = [];
  for (let audioFile of audioFiles) {
    const transcript = await generateTranscript(audioFile);
    transcripts.push(transcript.segments);
  }

  return transcripts.map((transcript) =>
    mergeTranscriptSegments(transcript, segmentLength)
  );
}

async function generateContinousStoryScenePrompts(scenceDescriptions, genre) {
  console.log("Batch Generating scence prompts");
  const systemMessage = {
    role: "system",
    content: `
    you are an expert on writing Stable Diffusion prompts to generate images for ${genre} stories. 
    below are the whole story:  ${scenceDescriptions.join(" ")}. 
    We will follow the formula to craft prompts: An image of [adjective] [subjuct] [doing action] [details] 
    All the image prompts need to suggest ${genre} styles
    `,
  };

  let messages = [systemMessage];
  const scenePrompts = [];

  for (scenceDescription of scenceDescriptions) {
    const prompt = {
      role: "user",
      content: `
      Now write a Stable Diffusion prompt for the following scene ${scenceDescription} based on the formula. 
      Please consider the context of the story provided and then fill the formula
      Please only output the prompt in plain text and don't include anything else. 
      `,
    };
    if (messages.length > 10) {
      messages = [systemMessage];
    }
    messages.push(prompt);
    const completion = await openai.chat.completions.create({
      messages,
      model: "gpt-3.5-turbo-0125",
    });
    scenePrompts.push(completion.choices[0].message.content);
  }

  return scenePrompts;
}

async function generateStoryContentByCharactor(content, characters) {
  console.log("Generating story lines");
  const systemMessage = {
    role: "system",
    content: `
    Below are the charactors in a story:  ${JSON.stringify(
      characters
    )} in json format
    I will give you a story segment by segment. 
    I want you to separate narrative from dialogs and if it is a dialog please also identify the charactor who speaks it.
    Then put all narratives and dialogs in temporal order, in the json with the format of [{type: "narrative"|"dialog", content, character }]
    Please strictly distinguish narratives and dialogs
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
        if (currentMergedChunk.length > 5000) {
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
      Now, for the following story segment, I want you to separate narrative from dialogs and if it is a dialog please also identify the charactor who speaks it.
      Then put all narratives and dialogs in temporal order, in the json with the format of [{type: "narrative"|"dialog", content, character }] 
      segment: ${contentChunk}
      
      Please only output the raw json and don't include any additional messaging and formatting
      `,
    };
    const messages = [systemMessage, prompt];
    const completion = await openai.chat.completions.create({
      messages,
      model: "gpt-4o",
    });
    messages.push(completion.choices[0].message);
    console.log(completion.choices[0].message.content);
    const json = completion.choices[0].message.content
      .replace("```json", "")
      .replace("```", "")
      .replace("...", "");

    storyLines.push(...JSON.parse(json));
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
    I want you to extract all characters from the story into a json in the format of [{name, gender, appearance, voiceType}]
    For gender, appearance and voiceType, please use your best knowledge. You can make up gender, appearance and voiceType if not specified in the story
    `,
  };

  const messages = [systemMessage];
  const prompt = {
    role: "user",
    content: `
    Now, for the following story, I want you to extract all characters from the story into a json in the format of [{name, gender, appearance, voiceType}]
    For gender, appearance and voiceType, please use your best knowledge. You can make up gender, appearance and voiceType if not specified in the story
    story: ${content}
    
    Please only output the raw json and don't include any additional messaging and formatting
    `,
  };
  messages.push(prompt);
  const completion = await openai.chat.completions.create({
    messages,
    model: "gpt-3.5-turbo-0125",
  });
  messages.push(completion.choices[0].message);
  const json = completion.choices[0].message.content
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
exports.mergeTranscriptSegments = mergeTranscriptSegments;
exports.generateStoryContentByCharactor = generateStoryContentByCharactor;
exports.extractCharactersFromStory = extractCharactersFromStory;