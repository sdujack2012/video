const fs = require("fs");
const path = require("path");
const { createFolderIfNotExist } = require("./utils");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const { getAudioDurationInSeconds } = require("get-audio-duration");
const { createCanvas, loadImage, registerFont } = require("canvas");
const {
  asyncParallelForEach,
  BACK_OFF_RETRY,
} = require("async-parallel-foreach");

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
  mythology: "./BGMs/inspiring-cinematic-ambient.mp3",
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
  let story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  if (story.videoFilePath && fs.existsSync(story.videoFilePath)) {
    console.log("Skip rendering video");
    return;
  }
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
  ctx.font = `60px "Title font"`;
  ctx.fillStyle = titleFontColor;
  const titleWidth = ctx.measureText(story.title).width;
  const titleSegments = [];

  if (titleWidth > canvas.width) {
    const titleparts = story.title.split(" ");
    const chunkSize = titleparts.length / Math.ceil(titleWidth / canvas.width);
    for (let i = 0; i < titleparts.length; i += chunkSize) {
      titleSegments.push(titleparts.slice(i, i + chunkSize).join(" "));
    }
  } else {
    titleSegments.push(story.title);
  }
  let currentY = 0;
  for (let titleSegment of titleSegments) {
    const title = titleSegment;
    const titleWidth = ctx.measureText(title).width;
    ctx.fillText(
      title,
      canvas.width / 2 - titleWidth / 2,
      (story.videoType === "short" ? canvas.height / 2 : 150) + currentY
    );
    currentY += 60;
  }

  const coverImageWithTitlePath = path.resolve(
    storyTempFolder,
    `cover_image_with_title.png`
  );
  fs.writeFileSync(coverImageWithTitlePath, canvas.toBuffer(), "binary");

  //Create title clip
  const titleAudioDuration =
    story.titleAudioDuration ||
    (await getAudioDurationInSeconds(story.titleAudio));
  const videoConfigClips = [
    {
      audioConfig: {
        startTime: clipGappingTime * 2,
        filePath: story.titleAudio,
        duration: titleAudioDuration,
      },
      clipImage: {
        filePath: coverImageWithTitlePath,
        duration: titleAudioDuration + 2,
      },
      clipWords: [],
      duration: titleAudioDuration + 2,
      noZoomIn: true,
    },
  ];

  for (let contentChunk of story.contentChunks) {
    const videoConfigClip = {};
    const clipWords = [];
    const audioDuration =
      contentChunk.audioDuration ||
      (await getAudioDurationInSeconds(contentChunk.audioFile));
    contentChunk.audioDuration = audioDuration;
    const audioConfig = {
      startTime: clipGappingTime,
      filePath: contentChunk.audioFile,
      duration: audioDuration,
    };

    const clipImage = {
      filePath: contentChunk.sceneImageFile,
      duration: audioDuration + 2 * clipGappingTime,
    };

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
    videoConfigClip.clipImage = clipImage;
    videoConfigClip.clipWords = clipWords;
    videoConfigClip.duration = clipImage.duration;
    videoConfigClips.push(videoConfigClip);
  }
  videoConfigClips.slice(-1)[0].duration += 4;
  let currentTime = 0;
  const subtitles = [];
  videoConfigClips.forEach((videoConfigClip) => {
    subtitles.push(
      ...videoConfigClip.clipWords.map((word) => {
        const words = [...word.words];
        const innerIndex = word.innerIndex;
        words[innerIndex] = `{\\c&H00FFFF&}${words[innerIndex]}{\\c&HFFFFFF&}`;

        return `Dialogue: 0,${new Date((word.start + currentTime) * 1000).toISOString().slice(12, -2)},${new Date((word.end + currentTime) * 1000).toISOString().slice(12, -2)},Default,,0,0,${subtitleY},,${words.join("")}`;
      })
    );
    currentTime += videoConfigClip.duration;
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
  const assFilePath = path.resolve(storyVideoFolder, `subtitle.ass`);
  fs.writeFileSync(assFilePath, assFile);

  const processLimit = 10;
  await asyncParallelForEach(
    videoConfigClips.toSorted((a, b) => a.duration - b.duration),
    processLimit,
    async (videoConfigClip, index) => {
      const mergedVideoPath = path.resolve(
        storyTempFolder,
        `temp_merged_video_${index}.mkv`
      );
      const zoomInRate = 0.0005;
      const framerate = 20;
      await exec(
        `ffmpeg -loop 1 -framerate ${framerate} -i "${videoConfigClip.clipImage.filePath}" \
       -vf ${videoConfigClip.noZoomIn ? `scale=${size.width}x${size.height}` : `"scale=8000:-1,zoompan=z='min(1.50,zoom+${zoomInRate})':x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${videoConfigClip.duration * framerate}:s=${size.width}x${size.height}:fps=${framerate}"`} \
      -t ${videoConfigClip.duration} -vcodec libx264 -pix_fmt yuv420p -y "${mergedVideoPath}"`
      );
      videoConfigClip.videoFilePath = mergedVideoPath;
    },
    {
      times: 10, // try at most 10 times
      interval: BACK_OFF_RETRY.exponential(),
    }
  );

  // Generate videos based on videoConfigClips by chunks to avoid ffmpng commands being too long
  const audioVideoPaths = [];
  // split clips into chunks
  const chunkSplitLimit = 30;
  const chunkSize = Math.ceil(
    videoConfigClips.length /
      Math.ceil(videoConfigClips.length / chunkSplitLimit)
  );
  const videoConfigClipChunks = [];
  for (let i = 0; i < videoConfigClips.length; i += chunkSize) {
    videoConfigClipChunks.push(videoConfigClips.slice(i, i + chunkSize));
  }
  await asyncParallelForEach(
    videoConfigClipChunks,
    5,
    async (videoConfigClipChunk, index) => {
      console.log(`Creating video chunk ${index}`);
      // join images with transition effects
      let previousOffset = 0;
      const transitionDuration = 0.2;
      const videoInputString = videoConfigClipChunk
        .map((videoConfigClip) => `-i "${videoConfigClip.videoFilePath}"`)
        .join(" ");
      const mergedVideoPath = path.resolve(
        storyTempFolder,
        `merged_video_${index}.mkv`
      );

      const videoTransitions = videoConfigClipChunk
        .map((videoConfigClip, index) => {
          if (videoConfigClipChunk.length - 1 === index) return "";

          const offset =
            videoConfigClip.duration + previousOffset - transitionDuration;
          previousOffset = offset;
          let transition = "";

          transition +=
            index === 0 ? "[0:v][1:v]" : `[vfade${index}][${index + 1}]`;
          transition += `xfade=transition=hrslice:duration=${transitionDuration}:offset=${offset}`;

          transition +=
            index === videoConfigClipChunk.length - 2
              ? ",format=yuv420p[video]"
              : `[vfade${index + 1}]`;

          return transition;
        })
        .join(";");

      await exec(
        `ffmpeg ${videoInputString} -filter_complex "${videoTransitions}" -movflags +faststart -map "[video]" -y "${mergedVideoPath}"`
      );

      // join aduios
      const mergedAuidoPath = path.resolve(
        storyTempFolder,
        `merged_audio_${index}.mp3`
      );
      const audioInputString = videoConfigClipChunk
        .map((videoConfigClip) => {
          const audioConfig = videoConfigClip.audioConfig;
          // mix video with audio
          const videoDuration = videoConfigClip.duration;
          let silencePaddingAfter =
            videoDuration - audioConfig.startTime - audioConfig.duration;
          silencePaddingAfter =
            silencePaddingAfter > 0 ? silencePaddingAfter : 0.01;
          return `-f lavfi -t "${audioConfig.startTime}" -i anullsrc=channel_layout=stereo:sample_rate=44100 -i "${audioConfig.filePath}" -f lavfi -t "${silencePaddingAfter}" -i anullsrc=channel_layout=stereo:sample_rate=44100`;
        })
        .join(" ");
      const joinAudiosCommand = `ffmpeg ${audioInputString} -filter_complex "${Array(
        3 * videoConfigClipChunk.length
      )
        .fill(0)
        .map((_, index) => `[${index}]`)
        .join(
          ""
        )} concat=n=${videoConfigClipChunk.length * 3}:v=0:a=1[audio]" -map "[audio]" -y "${mergedAuidoPath}"`;
      await exec(joinAudiosCommand);

      // join video with audio
      const audioVideoPath = path.resolve(
        storyTempFolder,
        `video_audio_${index}.mkv`
      );
      audioVideoPaths[index] = audioVideoPath;
      const mixAudioVideoCommand = `ffmpeg -i "${mergedVideoPath}" -i "${mergedAuidoPath}" -c:v copy -c:a copy -y "${audioVideoPath}"`;
      await exec(mixAudioVideoCommand);
    },
    {
      times: 10, // try at most 10 times
      interval: BACK_OFF_RETRY.exponential(),
    }
  );

  // merge video_aduio chunchs
  console.log(`Merging video with audio`);
  const videoList = audioVideoPaths
    .map((audioVideoPath) => `file '${audioVideoPath}'`)
    .join("\n");
  const videoListPath = path.resolve(storyTempFolder, `video_list.txt`);
  fs.writeFileSync(videoListPath, videoList);

  const mergedVideoPath = path.resolve(storyTempFolder, `merged_video.mkv`);
  await exec(
    `ffmpeg -safe 0 -f concat -i "${videoListPath}" -c copy -y "${mergedVideoPath}"`
  );

  //mix merged videos with bgm
  console.log(`mix merged videos with bgm`);
  const finalVideoPath = path.resolve(storyVideoFolder, `video.mkv`);
  await exec(
    `ffmpeg -i "${mergedVideoPath}"  -stream_loop -1 -i "${bgm}" -filter_complex "[0:a][1:a] amix=inputs=2:duration=first[outa]" -c:v copy -c:a aac -map 0:v -map "[outa]" -y "${finalVideoPath}"`
  );

  story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  story.videoFilePath = finalVideoPath;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));

  console.log("time elapsed:", (Date.now() - current) / 60000);
}

if (require.main === module && process.argv[2]) {
  renderVideo(process.argv[2]);
}

exports.renderVideo = renderVideo;
