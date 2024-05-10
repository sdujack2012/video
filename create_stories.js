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
  stories = storyTitle ? [{ title: storyTitle }] : stories;
  const storiesToCreate = [];
  for (let story of stories) {
    const storyFolder = createFolderIfNotExist(
      "G:/story video/videos",
      story.title
    );
    const storyJsonPath = path.resolve(storyFolder, "story.json");
    if (!fs.existsSync(storyJsonPath)) {
      fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
    }
    const existingStory = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
    if (storyTitle === story.title) {
      if (fs.existsSync(existingStory.videoFilePath)) {
        fs.unlinkSync(existingStory.videoFilePath);
      }
    }

    if (fs.existsSync(existingStory.videoFilePath)) {
      continue;
    }

    storiesToCreate.push(story.title);
  }

  for (let title of storiesToCreate) {
    try {
      console.log(`Creating video: ${title}`);
      await generateVideoResources(title);
      // await generateStoryExtractInfo(story.title);
      // await splitStoryIntoChunks(story.title);
      // await generateStoryAudios(story.title);
      // await generateTranscript(story.title);
      // await generateScenePrompts(story.title);
      // await generateScenes(story.title);
      await renderVideo(title);
    } catch (ex) {
      console.log(ex);
    }
  }
}

if (require.main === module) {
  createShortStories(process.argv[2]);
}
