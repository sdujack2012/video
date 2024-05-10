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
} = require("./resources_utils");

async function generateScenes(title, width, height) {
  const storyFolder = createFolderIfNotExist("short_story", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const storyImageFolder = createFolderIfNotExist(storyFolder, "images");

  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  if (story.hasImage) {
    console.log("Skip Generate generate images");
    return;
  }

  const imagesInfos = [];
  story.contentChunks.forEach((contentChunk, chunkIndex) => {
    contentChunk.transcript.forEach((segment, segmentIndex) => {
      segment.sceneImageFile = path.resolve(
        storyImageFolder,
        `scene ${chunkIndex + 1}_${segmentIndex + 1}.png`
      );
      if (!fs.existsSync(segment.sceneImageFile)) {
        imagesInfos.push({
          outputFile: segment.sceneImageFile,
          prompt: segment.sceneImagePrompts,
          width,
          height,
        });
      }
    });
  });
  if (imagesInfos.length === 0) {
    console.log("Skip Generate generate images");
    return;
  }

  await batchGenerateImagesByPrompts(imagesInfos);
  story.hasImage = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story));
}

function splitLongTextIntoChunks(content) {
  const chunckSize = 500;
  const separators = ["\n", ".", ";", "?"];
  const chuncks = [...content]
    .reduce(
      (mergedChunks, char) => {
        const currentChunk = mergedChunks[mergedChunks.length - 1];
        if (
          currentChunk.length > chunckSize &&
          separators.includes(currentChunk.charAt(currentChunk.length - 1))
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
  if (story.hasAudios) {
    console.log("Skip generate auidos");
    return;
  }
  const narratorVoiceFile = "./speakers/matt.mp3";

  const audioFileInfos = [];
  story.titleAudio = path.resolve(storyAudioFolder, `titleAudio.mp3`);
  audioFileInfos.push({
    text: story.title,
    outputFile: story.titleAudio,
    speakerVoiceFile: narratorVoiceFile,
  });

  //create content chuncks and the audio file names
  if (!story.hasContentChuncks) {
    if (!story.contentChunks) {
      story.contentChunks = await generateStoryContentByCharactor(
        story.content,
        story.characters
      );
    } else {
      story.contentChunks = story.contentChunks.map((contentChunk, index) => ({
        ...contentChunk,
        audioFile: path.resolve(storyAudioFolder, `chunk ${index + 1}.mp3`),
      }));
    }
  }

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
  fs.writeFileSync(storyJsonPath, JSON.stringify(story));

  const characterVoiceFileMappings = {};

  characterVoiceFileMappings["Narrator"] = narratorVoiceFile;

  const maleVoiceFiles = [
    "./speakers/man 1.mp3",
    "./speakers/bill.mp3",
    "./speakers/man 2.mp3",
    "./speakers/man 3.mp3",
    "./speakers/jeff.mp3",
  ];

  const femaleVoiceFiles = [
    "./speakers/woman 1.mp3",
    "./speakers/betty.mp3",
    "./speakers/linda.mp3",
    "./speakers/woman 2.mp3",
    "./speakers/woman 3.mp3",
    "./speakers/woman 4.mp3",
  ];

  const femaleCharacters = story.characters.filter(
    (character) => character.gender === "female"
  );
  if (femaleCharacters.length > femaleVoiceFiles.length) {
    throw "More female voice files needed";
  }
  femaleCharacters.forEach((character, index) => {
    characterVoiceFileMappings[character.name] = femaleVoiceFiles[index];
  });

  const maleCharacters = story.characters.filter(
    (character) => character.gender !== "female"
  );
  if (maleCharacters.length > maleVoiceFiles.length) {
    throw "More male voice files needed";
  }
  maleCharacters.forEach((character, index) => {
    characterVoiceFileMappings[character.name] = maleVoiceFiles[index];
  });

  console.log(story);
  fs.writeFileSync(storyJsonPath, JSON.stringify(story));

  audioFileInfos.push(
    ...story.contentChunks.map((contentChunk, index) => ({
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

  console.log("audioFileInfos", audioFileInfosToCreate);
  await batchGenerateAudios(audioFileInfosToCreate);
  story.hasAudios = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story));
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
    5
  );
  transcripts.forEach((transcript, index) => {
    story.contentChunks[index].transcript = transcript;
  });

  story.hasTranscripts = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story));
}

async function generateScenePrompts(title) {
  const storyFolder = createFolderIfNotExist("short_story", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  if (story.hasImagePrompts) {
    console.log("Skip Generate generate image prompt");
    return;
  }

  for (let index = 0; index < story.contentChunks.length; index++) {
    const contentChunk = story.contentChunks[index];
    const promps = await generateContinousStoryScenePrompts(
      contentChunk.transcript.map((segment) => segment.text),
      story.genre
    );
    promps.forEach((promp, index) => {
      contentChunk.transcript[index].sceneImagePrompts = promp;
    });
  }

  story.hasImagePrompts = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story));
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
  fs.writeFileSync(storyJsonPath, JSON.stringify(story));
}

const sizeMapping = {
  standard: { width: 1344, height: 768 },
  short: { width: 768, height: 1344 },
};

async function generateShortVideoResources(title) {
  const storyFolder = createFolderIfNotExist("short_story", title);
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  const size = sizeMapping[story.videoType];
  if (!story.genre || !size) {
    throw "Please specify genre and videoType";
  }
  await generateStoryExtractInfo(title);
  await generateStoryAudios(title);
  await generateTranscript(title);
  await generateScenePrompts(title);
  await generateScenes(title, size.width, size.height);
}

exports.generateShortVideoResources = generateShortVideoResources;

if (require.main === module && process.argv[2] && process.argv[2].length > 10) {
  generateShortVideoResources(process.argv[2]);
}