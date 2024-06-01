const fs = require("fs");
const path = require("path");
const { createFolderIfNotExist } = require("./utils");
const { generateShortVideoResources } = require("./generate_story_resources");
const { renderShortVideo } = require("./render_video");

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
    await generateShortVideoResources(story.title);
    const existingStory = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
    if (fs.existsSync(existingStory.videoFile)) {
      continue;
    }
    await renderShortVideo(story.title);
  }
}

if (require.main === module) {
  createShortStories();
}
