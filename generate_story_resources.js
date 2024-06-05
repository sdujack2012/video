const fs = require("fs");
const path = require("path");
const { createFolderIfNotExist, startOllama } = require("./utils");
const {
  batchGenerateImagesByPrompts,
  batchGenerateAudios,
  batchGenerateTranscripts,
  generateContinousStoryScenePrompts,
  generateStoryContentByCharactor,
  extractCharactersFromStory,
  generateStoryCoverPrompt,
} = require("./resources_utils");
const { getAudioDurationInSeconds } = require("get-audio-duration");

async function generateScenes(title) {
  const storyFolder = createFolderIfNotExist("short_story", title);
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
  const chunckSize = 400;
  const separators = ["\n", ".", ";", "?", "!", ","];
  const chuncks = [...content]
    .reduce(
      (mergedChunks, char) => {
        const currentChunk = mergedChunks[mergedChunks.length - 1];
        if (
          currentChunk.length > chunckSize &&
          separators.includes(currentChunk.charAt(currentChunk.length - 1) + "")
        ) {
          mergedChunks.push(char + "");
        } else {
          mergedChunks[mergedChunks.length - 1] = currentChunk + char;
        }
        return mergedChunks;
      },
      [""]
    )
    .map((chunck) => chunck.trim())
    .filter((chunck) => chunck);

  let longChunk = chuncks.find((chunck) => chunck.length > chunckSize + 400);
  if (longChunk) throw `Too long: ${longChunk}`;
  return chuncks;
}

async function generateStoryAudios(title) {
  const storyFolder = createFolderIfNotExist("short_story", title);
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

  story.contentChunks = story.contentChunks
    .reduce((splitedChuncks, contentChunk) => {
      const currentSplitChunks = splitLongTextIntoChunks(contentChunk.content);
      splitedChuncks.push(
        ...currentSplitChunks.map((content) => ({
          ...contentChunk,
          content,
        }))
      );
      return splitedChuncks;
    }, [])
    .map((contentChunk, index) => ({
      ...contentChunk,
      audioFile: path.resolve(storyAudioFolder, `chunk ${index + 1}.mp3`),
    }));

  story.hasContentChuncks = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));

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

  const femaleCharacters = story.characters.filter(
    (character) => character.gender?.toLocaleLowerCase() === "female"
  );
  if (femaleCharacters.length > femaleVoiceFiles.length) {
    throw "More female voice files needed";
  }
  femaleCharacters.forEach((character, index) => {
    characterVoiceFileMappings[character.name] = femaleVoiceFiles[index];
  });

  const maleCharacters = story.characters.filter(
    (character) => character.gender?.toLocaleLowerCase() !== "female"
  );
  if (maleCharacters.length > maleVoiceFiles.length) {
    throw "More male voice files needed";
  }
  maleCharacters.forEach((character, index) => {
    characterVoiceFileMappings[character.name] = maleVoiceFiles[index];
  });

  console.log(story);
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));

  audioFileInfos.push(
    ...story.contentChunks.map((contentChunk) => ({
      text: contentChunk.content,
      outputFile: contentChunk.audioFile,
      speakerVoiceFile: characterVoiceFileMappings[contentChunk.character]
        ? characterVoiceFileMappings[contentChunk.character]
        : characterVoiceFileMappings["Narrator"],
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
  story.hasAudios = true;
  let totalDuration = 0;
  for (let audioFileInfo of audioFileInfos) {
    totalDuration += await getAudioDurationInSeconds(audioFileInfo.outputFile);
  }
  story.videoType = totalDuration > 51 ? "standard" : "short";
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function generateCharacterLines(title) {
  const storyFolder = createFolderIfNotExist("short_story", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));

  if (story.hasContentChuncks) {
    console.log("Skip generating character lines");
    return;
  }

  story.contentChunks = await generateStoryContentByCharactor(
    story.content,
    story.characters
  );

  story.hasContentChuncks = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function generateTranscript(title) {
  const storyFolder = createFolderIfNotExist("short_story", title);
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
  const storyFolder = createFolderIfNotExist("short_story", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  if (!story.coverImagePrompt) {
    story.coverImagePrompt = await generateStoryCoverPrompt(
      story.contentChunks[0].content,
      story.genre,
      story.characters
    );
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

  const sceneImagePrompts = await generateContinousStoryScenePrompts(
    sceneDescriptions,
    story.genre,
    story.characters
  );

  story.contentChunks.forEach((contentChunk, index) => {
    contentChunk.sceneImagePrompt = sceneImagePrompts[index];
  });

  story.hasImagePrompts = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}
async function generateStoryExtractInfo(title) {
  const storyFolder = createFolderIfNotExist("short_story", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  if (story.hasCharacters) {
    console.log("Skip extracting characters");
    return;
  }
  story.characters = await extractCharactersFromStory(story.content);
  story.hasCharacters = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
}

async function generateVideoResources(title) {
  const process = await startOllama();
  await generateStoryExtractInfo(title);
  await generateCharacterLines(title);
  await generateStoryAudios(title);
  await generateTranscript(title);
  await generateScenePrompts(title);
  process.terminate();

  await generateScenes(title);
}

exports.generateVideoResources = generateVideoResources;
exports.generateStoryExtractInfo = generateStoryExtractInfo;
exports.generateStoryAudios = generateStoryAudios;
exports.generateTranscript = generateTranscript;
exports.generateScenePrompts = generateScenePrompts;
exports.generateScenes = generateScenes;
exports.generateCharacterLines = generateCharacterLines;

if (require.main === module && process.argv[2]) {
  generateVideoResources(process.argv[2]);
}
