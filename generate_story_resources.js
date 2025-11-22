const fs = require("fs");
const path = require("path");
const { createFolderIfNotExist } = require("./utils");
const {
  batchGenerateImagesByPrompts,
  batchGenerateVideosByPrompts,
  batchGenerateAudios,
  batchGenerateTranscripts,
  generateContinousStoryScenePrompts,
  generateContinousStorySceneVideoPrompts,
  generateStoryContentByCharactor,
  extractCharactersFromStory,
  speedUpAudio,
  generateStoryCoverPrompt,
  batchRefineVideoPromptsComfyUI,
  batchRefineVideoPromptsOllama,
  extractCharactersWithAppearance
} = require("./resources_utils");
const { getAudioDurationInSeconds } = require("get-audio-duration");
const { createVideoClipConfigs } = require("./render_video");
const { sizeMapping } = require("./config");

async function generateScenes(title) {
  const storyFolder = createFolderIfNotExist(__dirname, "videos", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const storyImageFolder = createFolderIfNotExist(storyFolder, "images");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  const { width, height } = sizeMapping["standard"];

  story.coverImageFile = path.resolve(storyImageFolder, `cover.png`);
  story.coverVideoFile =
    story.enableVideo && path.resolve(storyImageFolder, `coverVideo.mp4`);
  let imagesInfos = [
    {
      imageFile: story.coverImageFile,
      videoFile: story.coverVideoFile,
      prompt: story.style + ", " + story.coverImagePrompt,
      refinedVideoPrompt: story.enableVideoPromptRefinement ? story.coverImagePrompt : undefined,
      videoPrompt: story.coverImagePrompt,
      audioDuration: story.titleAudioDuration,
      width,
      height,
      isCover: true
    },
  ];

  if (!story.coverOnly) {
    story.contentChunks.forEach((contentChunk, chunkIndex) => {
      contentChunk.sceneImageFile = path.resolve(
        storyImageFolder,
        `scene${chunkIndex + 1}.png`
      );

      contentChunk.sceneVideoFile =
        story.enableVideo &&
        path.resolve(storyImageFolder, `sceneVideo${chunkIndex + 1}.mp4`);
      contentChunk.imageSize = { width, height };

      imagesInfos.push({
        imageFile: contentChunk.sceneImageFile,
        videoFile: contentChunk.sceneVideoFile,
        prompt: story.style + ", " + contentChunk.sceneImagePrompt,
        videoPrompt: contentChunk.videoPrompt || contentChunk.sceneImagePrompt,
        refinedVideoPrompt: story.enableVideoPromptRefinement ? contentChunk.refinedVideoPrompt : undefined,
        audioDuration: contentChunk.audioDuration,
        width,
        height,
        isCover: false,
      });
    });
  }

  const skip = imagesInfos.every(
    (imagesInfo) =>
      fs.existsSync(imagesInfo.imageFile) &&
      (!story.enableVideo || fs.existsSync(imagesInfo.videoFile))
  );

  if (skip) {
    console.log("Skip Generate images");
    return;
  }

  await batchGenerateImagesByPrompts(imagesInfos);
  if (story.enableVideo) {
    if (story.enableVideoPromptRefinement) {
      console.log("Refining video prompts");
      await batchRefineVideoPromptsOllama(imagesInfos);
      const contentChunkimagesInfos = imagesInfos.filter(info => !info.isCover);

      story.contentChunks.forEach((_, index) => {
        story.contentChunks[index].refinedVideoPrompt = contentChunkimagesInfos[index].refinedVideoPrompt;
      })
      fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
    } else {
      console.log("Skipping video prompt refinement (disabled by flag)");
    }
    await batchGenerateVideosByPrompts(imagesInfos);
  }
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

function splitLongTextIntoChunks(content, tokenLimit = 30) {

  const absoluteSeparators = ["***"];
  const relativeSeparators = ["\n", ".", "?", "!"];
  content = content.replace(/\n{1,}/gm, "\n");
  const chineseToEnglishPunctuation = {
    '，': ',',    // Chinese comma to English comma
    '。': '.',    // Chinese full stop to English period
    '？': '?',    // Chinese question mark to English question mark
    '！': '!',    // Chinese exclamation mark to English exclamation mark
    '”': '"',    // Chinese closing quotation mark
    '“': '"',    // Chinese opening quotation mark
    '：': ':',    // Chinese colon
    '；': ';',    // Chinese semicolon
    '（': '(',    // Chinese opening parenthesis
    '）': ')',    // Chinese closing parenthesis
  };
  chineseToEnglishPunctuationKeys = Object.keys(chineseToEnglishPunctuation);
  chineseToEnglishPunctuationKeys.forEach((key) => {
    const value = chineseToEnglishPunctuation[key];
    const regex = new RegExp(`\\${key}{1,}`, "gm");
    content = content.replace(regex, value);
  });

  const splitContentIntoChunks = (contentToSplit, separator) => {
    // If the content is short enough, return as is
    // For Chinese, count characters instead of words
    const isChinese = /[\u4e00-\u9fa5]/.test(contentToSplit);
    if (
      (isChinese && contentToSplit.length <= tokenLimit) ||
      (!isChinese && contentToSplit.split(" ").length <= tokenLimit)
    ) {
      return [contentToSplit];
    }

    return contentToSplit
      .split(separator)
      .filter((contentChunk) => contentChunk.trim());
  };

  const mergeContentChunks = (chunksToMerge, separator) => {
    const chunks = [chunksToMerge[0]];
    const restchunksToMerge =
      chunksToMerge.length > 1 ? chunksToMerge.slice(1) : [];
    for (let index = 0; index < restchunksToMerge.length; index++) {
      const currentChunk = chunks[chunks.length - 1];
      const chunkToMerge = restchunksToMerge[index];
      const isChinese = /[\u4e00-\u9fa5]/.test(currentChunk);

      if (
        (!isChinese && currentChunk.split(" ").length + chunkToMerge.split(" ").length >
          tokenLimit || currentChunk.split(" ").length > 6) ||
        (isChinese && currentChunk.length + chunkToMerge.length >
          tokenLimit || currentChunk.length > 40)
      ) {
        chunks[chunks.length - 1] =
          chunks[chunks.length - 1].trim() + separator;
        chunks.push(chunkToMerge);
      } else {
        chunks[chunks.length - 1] += separator + chunkToMerge.trim();
      }
    }
    return chunks;
  };

  let chunks = [content];
  absoluteSeparators.forEach((separator) => {
    chunks = chunks
      .map((chunk) => chunk.split(separator))
      .flatMap((chunks) => chunks)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 1);
  });
  relativeSeparators.forEach((separator) => {
    chunks = chunks
      .map((chunk) =>
        mergeContentChunks(splitContentIntoChunks(chunk, separator), separator)
      )
      .flatMap((chunk) => chunk)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 1);
  });

  return chunks;
}

function assignVoicesForCharacters(characters) {
  const characterVoiceFileMappings = {};

  const maleVoiceFiles = [
    "./resources/speakers/man 1.mp3",
    "./resources/speakers/EnglishAustraliaWilliam.mp3",
    "./resources/speakers/bill.mp3",
    "./resources/speakers/man 2.mp3",
    "./resources/speakers/man 3.mp3",
    "./resources/speakers/jeff.mp3",
    "./resources/speakers/man 4.mp3",
    "./resources/speakers/man 5.mp3",
    "./resources/speakers/man 6.mp3",
    "./resources/speakers/man 7.mp3",
    "./resources/speakers/man 8.mp3",
    "./resources/speakers/man 9.mp3",
    "./resources/speakers/man 10.mp3",
    "./resources/speakers/man 11.mp3",
    "./resources/speakers/man 12.mp3",
    "./resources/speakers/man 13.mp3",
    "./resources/speakers/man 14.mp3",
  ];

  const femaleVoiceFiles = [
    "./resources/speakers/woman 1.mp3",
    "./resources/speakers/betty.mp3",
    "./resources/speakers/linda.mp3",
    "./resources/speakers/woman 2.mp3",
    "./resources/speakers/woman 3.mp3",
    "./resources/speakers/woman 4.mp3",
    "./resources/speakers/woman 5.mp3",
    "./resources/speakers/woman 6.mp3",
    "./resources/speakers/woman 7.mp3",
    "./resources/speakers/woman 8.mp3",
    "./resources/speakers/woman 9.mp3",
    "./resources/speakers/woman 10.mp3",
  ];

  const femaleCharacters = characters.filter(
    (character) => character.gender?.toLocaleLowerCase() === "female"
  );
  if (femaleCharacters.length > femaleVoiceFiles.length) {
    throw "More female voice files needed";
  }

  femaleCharacters.forEach((character, index) => {
    characterVoiceFileMappings[character.name] = femaleVoiceFiles[index];
  });

  const maleCharacters = characters.filter(
    (character) => character.gender?.toLocaleLowerCase() !== "female"
  );
  if (maleCharacters.length > maleVoiceFiles.length) {
    throw "More male voice files needed";
  }
  maleCharacters.forEach((character, index) => {
    characterVoiceFileMappings[character.name] = maleVoiceFiles[index];
  });

  return characterVoiceFileMappings;
}

async function generateStoryAudios(title) {
  const storyFolder = createFolderIfNotExist(__dirname, "videos", title);
  console.log("storyFolder", storyFolder);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const storyAudioFolder = createFolderIfNotExist(storyFolder, "aduios");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));

  const narratorVoiceFiles = {
    mythology: "./resources/speakers/man 2.mp3",
    horror: "./resources/speakers/Vincent Price.mp3",
    kid: "./resources/speakers/man 2.mp3",
  };
  const defaultNarratorVoiceFile = "./resources/speakers/matt.mp3";
  const narratorVoiceFile = path.resolve(
    story.speakerFile ||
    narratorVoiceFiles[story.genre] ||
    defaultNarratorVoiceFile);

  const audioFileInfos = [];
  story.titleAudio = path.resolve(storyAudioFolder, `titleAudio.mp3`);
  audioFileInfos.push({
    text: story.title,
    outputFile: story.titleAudio,
    speakerVoiceFile: narratorVoiceFile,
  });

  const characterVoiceFileMappings = story.enableRoles
    ? assignVoicesForCharacters(story.characters)
    : {}; // awalys use narratorVoiceFile
  characterVoiceFileMappings["Narrator"] = narratorVoiceFile;
  story.contentChunks = story.contentChunks.map((contentChunk, index) => ({
    ...contentChunk,
    audioFile: path.resolve(storyAudioFolder, `chunk ${index + 1}.mp3`),
  }));

  audioFileInfos.push(
    ...story.contentChunks.map((contentChunk) => ({
      text: contentChunk.content,
      outputFile: contentChunk.audioFile,
      speakerVoiceFile: characterVoiceFileMappings[contentChunk.character]
        ? characterVoiceFileMappings[contentChunk.character]
        : narratorVoiceFile,
    }))
  );

  const audioFileInfosToCreate = audioFileInfos.filter(
    (audioFileInfo) => !fs.existsSync(audioFileInfo.outputFile)
  );

  if (audioFileInfosToCreate.length === 0) {
    console.log("Skipping generating audios");
  } else {
    await batchGenerateAudios(audioFileInfosToCreate);

  }

  if (story.speedFactor) {
    story.titleAudio = await speedUpAudio(story.titleAudio, story.speedFactor);
    for (let contentChunk of story.contentChunks) {
      contentChunk.audioFile = await speedUpAudio(
        contentChunk.audioFile,
        story.speedFactor
      );
    }
  }

  story.hasAudios = true;
  story.titleAudioDuration =
    story.titleAudioDuration ||
    (await getAudioDurationInSeconds(story.titleAudio));

  for (let contentChunk of story.contentChunks) {
    contentChunk.audioDuration = await getAudioDurationInSeconds(
      contentChunk.audioFile
    );
  }

  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function splitStoryIntoChunks(title) {
  const storyFolder = createFolderIfNotExist(__dirname, "videos", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));

  if (story.contentChunks) {
    console.log("Skip generating content chuncks");
    return;
  }

  if (story.enableRoles) {
    story.characters =
      story.characters || (await extractCharactersFromStory(story.content));
    fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
    story.contentChunks = await generateStoryContentByCharactor(
      story.content,
      story.characters
    );

    story.contentChunks = story.contentChunks.flatMap((contentChunk) => {
      const currentSplitChunks = splitLongTextIntoChunks(contentChunk.content);

      return currentSplitChunks.map((content) => ({
        ...contentChunk,
        content,
      }));
    });
  } else {
    story.contentChunks = splitLongTextIntoChunks(story.content, story.splitTokenLimit || undefined).map(
      (content) => ({ content })
    );
  }

  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function generateStoryExtractInfo(title) {
  const storyFolder = createFolderIfNotExist(__dirname, "videos", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));

  if (story.characters && story.characters.length > 0) {
    console.log("Characters already extracted, skipping");
    return;
  }

  console.log("Extracting characters with detailed appearances from story");
  const characters = await extractCharactersWithAppearance(story.content);
  story.characters = characters;

  console.log(`Extracted ${characters.length} characters:`, characters.map(c => c.name).join(", "));
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function generateTranscript(title) {
  const storyFolder = createFolderIfNotExist(__dirname, "videos", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  if (story.hasTranscripts) {
    console.log("skip generate transcript");
    return;
  }

  const transcripts = await batchGenerateTranscripts(
    story.contentChunks.map((contentChunk) => contentChunk.audioFile),
    10
  );
  transcripts.forEach((transcript, index) => {
    story.contentChunks[index].transcript = transcript;
  });

  story.hasTranscripts = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function generateScenePrompts(title) {
  const storyFolder = createFolderIfNotExist(__dirname, "videos", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  if (!story.coverImagePrompt) {
    story.coverImagePrompt = (
      await generateStoryCoverPrompt(
        [
          story.contentChunks
            .slice(0, 100)
            .map((chunck) => chunck.content)
            .join(". "),
        ],
        story.genre,
        story.style,
        story.characters
      )
    );
    fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
  } else {
    console.log("Skip Generate cover image prompt");
  }

  if (!story.coverOnly) {
    const chuncksWithoutImagePrompts = story.contentChunks.filter(
      (chunk) => !chunk.sceneImagePrompt
    );

    const imagePrompts = await generateContinousStoryScenePrompts(
      story.title,
      chuncksWithoutImagePrompts.map(contentChunk => contentChunk.content),
      story.genre,
      story.style,
      story.characters
    );

    chuncksWithoutImagePrompts.forEach((_, index) => {
      chuncksWithoutImagePrompts[index].sceneImagePrompt = imagePrompts[index];
    })

    fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
  }

  if (story.enableVideo) {
    const chuncksWithVideoPrompts = story.contentChunks.filter(
      (chunk) => !chunk.videoPrompt
    );

    const videoPrompts = await generateContinousStorySceneVideoPrompts(
      story.title,
      chuncksWithVideoPrompts.map(contentChunk => contentChunk.content),
      chuncksWithVideoPrompts.map(contentChunk => contentChunk.sceneImagePrompt),
      story.genre,
      story.style,
      story.characters
    );


    chuncksWithVideoPrompts.forEach((_, index) => {
      chuncksWithVideoPrompts[index].videoPrompt = videoPrompts[index].videoPrompt;
    })

    fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
  }
}

async function generateVideoResources(title) {
  await generateStoryExtractInfo(title);
  await splitStoryIntoChunks(title);
  await generateScenePrompts(title);

  await generateStoryAudios(title);
  //await generateTranscript(title);
  await generateScenes(title);
}

exports.generateVideoResources = generateVideoResources;
exports.generateStoryExtractInfo = generateStoryExtractInfo;
exports.generateStoryAudios = generateStoryAudios;
exports.generateTranscript = generateTranscript;
exports.generateScenePrompts = generateScenePrompts;
exports.generateScenes = generateScenes;
exports.splitStoryIntoChunks = splitStoryIntoChunks;

if (require.main === module && process.argv[2]) {
  generateVideoResources(process.argv[2]);
}
