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

async function createShortStories() {
  const storiesPath = path.resolve("stories.json");
  const stories = JSON.parse(fs.readFileSync(storiesPath, "utf8"));
  console.log(stories);
  for (let story of stories) {
    const storyFolder = createFolderIfNotExist("short_story", story.title);
    const storyJsonPath = path.resolve(storyFolder, "story.json");
    if (!fs.existsSync(storyJsonPath)) {
      fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
    }
    await generateVideoResources(story.title);
    // await generateStoryExtractInfo(story.title);
    // await splitStoryIntoChunks(story.title);
    // await generateStoryAudios(story.title);
    // await generateTranscript(story.title);
    // await generateScenePrompts(story.title);
    // await generateScenes(story.title);

    const existingStory = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
    if (fs.existsSync(existingStory.videoFile) && existingStory.hasVideo) {
      console.log("Skip rendering video");
      continue;
    }
    console.log("Rendering video");
    await renderVideo(story.title);
  }
}

if (require.main === module) {
  createShortStories();
}
