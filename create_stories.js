const fs = require("fs");
const path = require("path");
const { createFolderIfNotExist } = require("./utils");
const {
  generateVideoResources,
  generateStoryExtractInfo,
  generateStoryAudios,
  generateTranscript,
  generateScenePrompts,
  splitStoryIntoChunks,
  generateScenes,
} = require("./generate_story_resources");
const { renderVideo } = require("./render_video");

async function createShortStories(storyTitle) {
  const storiesPath = path.resolve("stories.json");
  let stories = JSON.parse(fs.readFileSync(storiesPath, "utf8"));
  stories = storyTitle
    ? stories.filter((story) => story.title === storyTitle)
    : stories;
  const storiesToCreate = [];
  for (let story of stories) {
    const storyFolder = createFolderIfNotExist("G:/videos", story.title);
    const storyJsonPath = path.resolve(storyFolder, "story.json");
    if (!fs.existsSync(storyJsonPath)) {
      fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
    }
    const existingStory = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
    if (fs.existsSync(existingStory.videoFilePath)) {
      continue;
    }

    storiesToCreate.push(story.title);
  }

  for (let title of storiesToCreate) {
    await generateVideoResources(title);
    // await generateStoryExtractInfo(story.title);
    // await splitStoryIntoChunks(story.title);
    // await generateStoryAudios(story.title);
    // await generateTranscript(story.title);
    // await generateScenePrompts(story.title);
    // await generateScenes(story.title);
    await renderVideo(title);
  }
}

if (require.main === module) {
  createShortStories(process.argv[2]);
}
