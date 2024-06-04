const fs = require("fs");
const path = require("path");
const { createFolderIfNotExist } = require("./utils");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const { getAudioDurationInSeconds } = require("get-audio-duration");
const { createCanvas, loadImage, registerFont } = require("canvas");

const sizeMapping = {
  standard: { width: 1360, height: 768 },
  short: { width: 768, height: 1360 },
};
const lineLengthMappings = {
  standard: 6,
  short: 4,
};

const lineYStartMappings = {
  standard: 700,
  short: 200,
};

const genreBGM = {
  horror: "./BGMs/Horror-Long-Version.mp3",
  default: "./BGMs/Sunset-Landscape.mp3",
  kid: "./BGMs/Sunset-Landscape.mp3",
};

const titleFonts = {
  horror: "./fonts/SUBTLE.TTF",
  default: "./fonts/Comfortaa_Bold.ttf",
  kid: "./fonts/Comfortaa_Bold.ttf",
};

const titleFontColors = {
  horror: "#FF0000",
  default: "#FFFF00",
  kid: "#FFFF00",
};

const coverImages = {
  standard: "./cover/scary_forest.png",
  short: "./cover/scary_forest_vertical.png",
};

const subtitleFontSizes = {
  standard: 40,
  short: 20,
};

const clipGappingTime = 0.5;

async function renderVideo(topic) {
  const current = Date.now();
  const storyFolder = createFolderIfNotExist("short_story", topic);
  const storyVideoFolder = createFolderIfNotExist(storyFolder, "videos");
  const storyTempFolder = createFolderIfNotExist(storyVideoFolder, "temp");

  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  const lineYStart = lineYStartMappings[story.videoType];

  const subtitleFontSize = subtitleFontSizes[story.videoType];
  const titleFont = titleFonts[story.genre]
    ? titleFonts[story.genre]
    : titleFonts["default"];
  const titleFontColor = titleFontColors[story.genre]
    ? titleFontColors[story.genre]
    : titleFontColors["default"];

  const size = sizeMapping[story.videoType];
  const subtitleYs = {
    standard: 0,
    short: size.height - 700,
  };
  const subtitleY = subtitleYs[story.videoType];
  const lineLength = lineLengthMappings[story.videoType];
  const coverImagePath = story.coverImageFile || coverImages[story.videoType];
  const bgm = genreBGM[story.genre]
    ? genreBGM[story.genre]
    : genreBGM["default"];

  if (!size || !bgm || !lineLength || !lineYStart || !titleFont) {
    return "Please fix videoType and genre";
  }

  registerFont(titleFont, { family: "Title font" });

  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  // Draw cat with lime helmet
  const coverImage = await loadImage(coverImagePath);

  ctx.drawImage(coverImage, 0, 0, canvas.width, canvas.height);
  ctx.font = '60px "Title font"';
  ctx.fillStyle = titleFontColor;
  const titleWidth = ctx.measureText(story.title).width;
  ctx.fillText(story.title, canvas.width / 2 - titleWidth / 2, 150);
  const coverImageWithTitlePath = path.resolve(
    storyTempFolder,
    `cover_image_with_title.png`
  );
  fs.writeFileSync(coverImageWithTitlePath, canvas.toBuffer(), "binary");

  //Create title clip
  const videoConfigClips = [
    {
      audioConfig: {
        startTime: clipGappingTime * 2,
        filePath: story.titleAudio,
        duration: await getAudioDurationInSeconds(story.titleAudio),
      },
      clipImages: [
        {
          filePath: coverImageWithTitlePath,
          duration: (await getAudioDurationInSeconds(story.titleAudio)) + 2,
        },
        //workaround for ffmpng bug for duration
        {
          filePath: coverImageWithTitlePath,
          duration: 0,
        },
      ],
      clipWords: [],
    },
  ];

  for (let contentChunk of story.contentChunks) {
    const videoConfigClip = {};
    const clipImages = [];
    const clipWords = [];
    const audioDuration = await getAudioDurationInSeconds(
      contentChunk.audioFile
    );
    const audioConfig = {
      startTime: clipGappingTime,
      filePath: contentChunk.audioFile,
      duration: audioDuration,
    };

    clipImages.push(
      {
        filePath: contentChunk.sceneImageFile,
        duration: audioDuration + 2 * clipImages,
      },
      //workaround for ffmpng bug for duration
      {
        filePath: contentChunk.sceneImageFile,
        duration: 0,
      }
    );

    //collect subtitles
    contentChunk.transcript.forEach(({ words }) => {
      const wordCountLimit = 6;
      const individualWords = words.map((word) => word.word);

      words.forEach((word, innerIndex) => {
        const numberOfChunks = Math.ceil(
          individualWords.length / wordCountLimit
        );
        const chunkSize = Math.ceil(individualWords.length / numberOfChunks);
        const wordChunkStart = Math.floor(innerIndex / chunkSize) * chunkSize;
        let wordChunkEnd =
          (Math.floor(innerIndex / chunkSize) + 1) * chunkSize + 1;
        wordChunkEnd =
          wordChunkEnd > individualWords.length
            ? individualWords.length
            : wordChunkEnd;
        word.words = individualWords.slice(wordChunkStart, wordChunkEnd);
        word.end =
          innerIndex < words.length - 1
            ? words[innerIndex + 1].start
            : word.end;
        word.innerIndex = innerIndex - wordChunkStart;
      });
      clipWords.push(...words);
    });

    // add gapping time
    clipWords.forEach((clipWord) => {
      clipWord.end += clipGappingTime;
      clipWord.start += clipGappingTime;
    });

    // add the clip config
    videoConfigClip.audioConfig = audioConfig;
    videoConfigClip.clipImages = clipImages;
    videoConfigClip.clipWords = clipWords;
    videoConfigClips.push(videoConfigClip);
  }

  for (let index = 0; index < videoConfigClips.length; index++) {
    const videoConfigClip = videoConfigClips[index];
    const { audioConfig, clipImages, clipWords } = videoConfigClip;

    const subtitles = clipWords.map((word) => {
      const words = [...word.words];
      const innerIndex = word.innerIndex;
      words[innerIndex] = `{\\c&H00FFFF&}${words[innerIndex]}{\\c&HFFFFFF&}`;
      return `Dialogue: 0,${new Date(word.start * 1000).toISOString().slice(12, -2)},${new Date(word.end * 1000).toISOString().slice(12, -2)},Default,,0,0,${subtitleY},,${words.join("")}`;
    });

    const assFile = `[Script Info]
; Script generated by Aegisub 3.2.2
; http://www.aegisub.org/
Title: Default Aegisub file
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: 1360
PlayResY: 768

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${subtitleFontSize},&H00FFFFFF,&H000000FF,&HC3000000,&HD9000000,0,0,0,0,100,100,0,0,3,10,10,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${subtitles.join("\n")}
      `;
    //console.log(assFile);
    const assFilePath = path.resolve(storyTempFolder, `subtitle_${index}.ass`);
    fs.writeFileSync(assFilePath, assFile);

    const videoDuration = clipImages.reduce(
      (totalDuration, clipImages) => totalDuration + clipImages.duration,
      0
    );
    const imageList = clipImages
      .map(
        (image) =>
          `file '${image.filePath}' \nduration ${image.duration.toFixed(2)}`
      )
      .join("\n");
    const imageListPath = path.resolve(
      storyTempFolder,
      `image_list_${index}.txt`
    );
    fs.writeFileSync(imageListPath, imageList);

    //create videos from image
    const videoImagesPath = path.resolve(
      storyTempFolder,
      `video_images_${index}.mkv`
    );
    await exec(
      `ffmpeg -safe 0 -f concat -i "${imageListPath}" -vf scale=${size.width}:${size.height} -c:v libx264 -r 30 -pix_fmt yuv420p -y "${videoImagesPath}"`
    );

    // mix video with audio
    let silencePaddingAfter =
      videoDuration - audioConfig.startTime - audioConfig.duration;
    silencePaddingAfter = silencePaddingAfter > 0 ? silencePaddingAfter : 0;
    const videoWithAudioPath = path.resolve(
      storyTempFolder,
      `video_audio_${index}.mkv`
    );
    const mixAudioVideoCommand = `ffmpeg -i "${videoImagesPath}" -f lavfi -t "${audioConfig.startTime}" -i anullsrc=channel_layout=stereo:sample_rate=44100 -i "${audioConfig.filePath}" ${silencePaddingAfter > 0 ? `-f lavfi -t "${silencePaddingAfter}" -i anullsrc=channel_layout=stereo:sample_rate=44100` : ""} -filter_complex "[1][2]${silencePaddingAfter > 0 ? "[3]" : ""} concat=n=${silencePaddingAfter > 0 ? "3" : "2"}:v=0:a=1[outa]" -shortest -c:v copy -map 0:v -map "[outa]" -y "${videoWithAudioPath}"`;
    await exec(mixAudioVideoCommand);

    //add subtitle
    const videoWithAuidoAndSubtitlePath = path.resolve(
      storyTempFolder,
      `video_subtitle_audio_${index}.mkv`
    );

    await exec(
      `ffmpeg -i "${videoWithAudioPath}" -i "${assFilePath}" -c:v copy -c:a copy -c:s copy -map 0:0 -map 0:1 -map 1:0 -y "${videoWithAuidoAndSubtitlePath}"`
    );
    videoConfigClip.videoWithAuidoAndSubtitlePath =
      videoWithAuidoAndSubtitlePath;
  }

  const videoList = videoConfigClips
    .map(
      (videoConfigClip) =>
        `file '${videoConfigClip.videoWithAuidoAndSubtitlePath}'`
    )
    .join("\n");
  const mergedVideoPath = path.resolve(storyTempFolder, `merged_video.mkv`);
  const mergedVideoListPath = path.resolve(storyTempFolder, `video_list.txt`);
  fs.writeFileSync(mergedVideoListPath, videoList);
  await exec(
    `ffmpeg -safe 0 -f concat -i "${mergedVideoListPath}" -c:v copy -c:a copy -c:s copy -y "${mergedVideoPath}"`
  );

  const finalVideoPath = path.resolve(storyVideoFolder, `video.mkv`);
  await exec(
    `ffmpeg -i "${mergedVideoPath}" -stream_loop -1 -i "${bgm}" -filter_complex "[0:a][1:a] amix=inputs=2:duration=first[outa]" -c:v copy -c:s copy -c:a aac -map 0:v -map 0:s -map "[outa]" -y "${finalVideoPath}"`
  );

  const originalStory = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));

  originalStory.videoFile = finalVideoPath;

  originalStory.hasVideo = true;
  fs.writeFileSync(storyJsonPath, JSON.stringify(originalStory, null, 4));
  console.log("time elapsed:", Date.now() - current);
}

if (require.main === module && process.argv[2]) {
  renderVideo(process.argv[2]);
}

exports.renderVideo = renderVideo;
