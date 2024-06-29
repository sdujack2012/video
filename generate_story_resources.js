const fs = require("fs");
const path = require("path");
const { createFolderIfNotExist } = require("./utils");
const {
  batchGenerateImagesByPrompts,
  batchGenerateAudios,
  batchGenerateTranscripts,
  generateContinousStoryScenePrompts,
  generateStoryContentByCharactor,
  extractCharactersFromStory,
  speedUpAudio,
  freeVRams,
} = require("./resources_utils");
const { getAudioDurationInSeconds } = require("get-audio-duration");
const { createVideoClipConfigs } = require("./render_video");
async function generateScenes(title) {
  const storyFolder = createFolderIfNotExist("E:/story video/videos", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const storyImageFolder = createFolderIfNotExist(storyFolder, "images");
  const sizeMapping = {
    standard: { width: 1360, height: 768 },
    short: { width: 768, height: 1360 },
  };
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  const { width, height } = sizeMapping[story.videoType];

  story.coverImageFile = path.resolve(storyImageFolder, `cover.png`);

  let imagesInfos = [
    {
      outputFile: story.coverImageFile,
      prompt: story.coverImagePrompt,
      width,
      height,
    },
  ];

  story.contentChunks.forEach((contentChunk, chunkIndex) => {
    contentChunk.sceneImageFile = path.resolve(
      storyImageFolder,
      `scene ${chunkIndex + 1}.png`
    );
    contentChunk.imageSize = { width, height };

    imagesInfos.push({
      outputFile: contentChunk.sceneImageFile,
      prompt: contentChunk.sceneImagePrompt,
      width,
      height,
    });
  });

  imagesInfos = imagesInfos.filter(
    (imagesInfo) => !fs.existsSync(imagesInfo.outputFile)
  );

  if (imagesInfos.length === 0) {
    console.log("Skip Generate images");
    return;
  }

  await batchGenerateImagesByPrompts(imagesInfos);
  story.hasImage = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

function splitLongTextIntoChunks(content) {
  const tokenLimit = 40;
  const maxToken = 200;

  const absoluteSeparators = ["***"];
  const relativeSeparators = ["\n", ".", "?", "!", ";"];
  content = content.replace(/\n{1,}/gm, "\n");
  const splitContentIntoChunks = (contentToSplit, separator) => {
    if (contentToSplit.split(" ").length <= tokenLimit) {
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
      if (
        currentChunk.split(" ").length + chunkToMerge.split(" ").length >
          tokenLimit &&
        currentChunk.split(" ").length > 6
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

  let longChunk = chunks.find((chunk) => chunk.split(" ").length > maxToken);

  return chunks;
}

function assignVoicesForCharacters(characters) {
  const narratorVoiceFile = "./speakers/matt.mp3";

  const characterVoiceFileMappings = {};

  characterVoiceFileMappings["Narrator"] = narratorVoiceFile;

  const maleVoiceFiles = [
    "./speakers/man 1.mp3",
    "./speakers/EnglishAustraliaWilliam.mp3",
    "./speakers/bill.mp3",
    "./speakers/man 2.mp3",
    "./speakers/man 3.mp3",
    "./speakers/jeff.mp3",
    "./speakers/man 4.mp3",
    "./speakers/man 5.mp3",
    "./speakers/man 6.mp3",
    "./speakers/man 7.mp3",
    "./speakers/man 8.mp3",
    "./speakers/man 9.mp3",
    "./speakers/man 10.mp3",
    "./speakers/man 11.mp3",
    "./speakers/man 12.mp3",
    "./speakers/man 13.mp3",
    "./speakers/man 14.mp3",
  ];

  const femaleVoiceFiles = [
    "./speakers/woman 1.mp3",
    "./speakers/betty.mp3",
    "./speakers/linda.mp3",
    "./speakers/woman 2.mp3",
    "./speakers/woman 3.mp3",
    "./speakers/woman 4.mp3",
    "./speakers/woman 5.mp3",
    "./speakers/woman 6.mp3",
    "./speakers/woman 7.mp3",
    "./speakers/woman 8.mp3",
    "./speakers/woman 9.mp3",
    "./speakers/woman 10.mp3",
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
  const storyFolder = createFolderIfNotExist("E:/story video/videos", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const storyAudioFolder = createFolderIfNotExist(storyFolder, "aduios");

  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  const narratorVoiceFile = "./speakers/matt.mp3";

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
    return;
  }

  await batchGenerateAudios(audioFileInfosToCreate);
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

  const videoClips = await createVideoClipConfigs(story, story.coverImageFile);

  story.estimatedDuration = videoClips.reduce(
    (totalDuration, videoClip) => videoClip.duration + totalDuration,
    0
  );

  story.videoType = story.estimatedDuration > 60 ? "standard" : "short";
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function splitStoryIntoChunks(title) {
  const storyFolder = createFolderIfNotExist("E:/story video/videos", title);
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
    story.contentChunks = splitLongTextIntoChunks(story.content).map(
      (content) => ({ content })
    );
  }

  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function generateTranscript(title) {
  const storyFolder = createFolderIfNotExist("E:/story video/videos", title);
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
  const storyFolder = createFolderIfNotExist("E:/story video/videos", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  if (!story.coverImagePrompt) {
    story.coverImagePrompt = (
      await generateContinousStoryScenePrompts(
        story.title,
        [
          story.contentChunks
            .slice(0, 10)
            .map((chunck) => chunck.content)
            .join(". "),
        ],
        story.genre,
        story.style,
        story.characters
      )
    )[0].sceneImagePrompt;
    fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
  } else {
    console.log("Skip Generate cover image prompt");
  }

  if (story.hasImagePrompts) {
    console.log("Skip Generate image prompt");
    return;
  }
  const sceneDescriptions = story.contentChunks.map(
    (contentChunk) => contentChunk.content
  );

  story.contentChunks = await generateContinousStoryScenePrompts(
    story.title,
    sceneDescriptions,
    story.genre,
    story.style,
    story.characters
  );

  story.hasImagePrompts = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}
async function generateVideoResources(title) {
  await splitStoryIntoChunks(title);
  await generateScenePrompts(title);

  await generateStoryAudios(title);
  //await generateTranscript(title);
  freeVRams();
  await generateScenes(title);
}

exports.generateVideoResources = generateVideoResources;
exports.generateStoryAudios = generateStoryAudios;
exports.generateTranscript = generateTranscript;
exports.generateScenePrompts = generateScenePrompts;
exports.generateScenes = generateScenes;
exports.splitStoryIntoChunks = splitStoryIntoChunks;

if (require.main === module && process.argv[2]) {
  generateVideoResources(process.argv[2]);
}
