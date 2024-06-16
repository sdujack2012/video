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

const {
  sizeMapping,
  genreBGM,
  titleFonts,
  titleFontColors,
  coverImages,
  subtitleFontSizes,
  clipGappingTime,
  framerate,
  transitionDuration,
  audioFadeOutDuration,
} = require("./config");

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

  const screenSize = sizeMapping[story.videoType];

  const bgm = genreBGM[story.genre]
    ? genreBGM[story.genre]
    : genreBGM["default"];

  if (!screenSize || !bgm) {
    return "Please fix videoType and genre";
  }

  const coverImageWithTitlePath = await addTitleToCoverImage(
    story,
    screenSize,
    storyTempFolder
  );

  const videoConfigClips = await createVideoClipConfigs(
    story,
    coverImageWithTitlePath
  );

  const assFilePath = createSubtitles(
    videoConfigClips,
    storyVideoFolder,
    story.videoType
  );

  // Render each video clip concurrently
  const processLimit = 7;
  await asyncParallelForEach(
    videoConfigClips,
    processLimit,
    async (videoConfigClip, index) => {
      const mergedVideoPath = path.resolve(
        storyTempFolder,
        `temp_merged_video_${index}.mkv`
      );
      try {
        await renderVideoClipConfig(
          videoConfigClip,
          screenSize,
          mergedVideoPath,
          framerate
        );
      } catch (ex) {
        console.log(ex);
        throw ex;
      }
    },
    {
      times: 1, // try at most 10 times
      interval: BACK_OFF_RETRY.exponential(),
    }
  );

  // Generate videos based on videoConfigClips by chunks to avoid ffmpng commands being too long
  const audioVideoPaths = [];

  // split clips into chunks
  const chunkSplitLimit = 30;
  const videoConfigClipChunks = splitArrayIntoChunks(
    videoConfigClips,
    chunkSplitLimit
  );

  await asyncParallelForEach(
    videoConfigClipChunks,
    7,
    async (videoConfigClipChunk, index) => {
      console.log(`Creating video chunk ${index}`);

      const audioVideoPath = path.resolve(
        storyTempFolder,
        `video_audio_${index}.mkv`
      );
      try {
        await renderVideoClipChunk(
          videoConfigClipChunk,
          storyTempFolder,
          audioVideoPath,
          index
        );
        audioVideoPaths[index] = audioVideoPath;
      } catch (ex) {
        console.log(ex);
        throw ex;
      }
    },
    {
      times: 1, // try at most 10 times
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

  //mix merged videos with bgm and subtitle
  console.log(`mix merged videos with bgm`);
  const finalVideoPath = path.resolve(storyVideoFolder, `video.mkv`);
  const totalDuration = videoConfigClips.reduce(
    (totalDuration, videoConfigClip) =>
      videoConfigClip.duration + totalDuration,
    0
  );

  await exec(
    `ffmpeg -i "${mergedVideoPath}" -stream_loop -1 -i "${bgm}" -i "${assFilePath}" -filter_complex "[0:a][1:a] amix=inputs=2:duration=first[aout];[aout]afade=type=out:duration=${audioFadeOutDuration}:start_time=${totalDuration - audioFadeOutDuration}[afinal]" -pix_fmt yuv420p -c:v copy -c:a aac -c:s copy -map 0:v -map "[afinal]" -map 2:s  -y "${finalVideoPath}"`
  );

  story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  story.videoFilePath = finalVideoPath;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));

  console.log("time elapsed:", (Date.now() - current) / 60000);
}

async function renderVideoClipChunk(
  videoConfigClipChunk,
  storyTempFolder,
  outputFilePath,
  index
) {
  const xfadeEffects = [
    "fade",
    "wipeleft",
    "wiperight",
    "wipeup",
    "wipedown",
    "slideleft",
    "slideright",
    "slideup",
    "slidedown",
    "circlecrop",
    "rectcrop",
    "distance",
    "fadeblack",
    "fadewhite",
    "radial",
    "smoothleft",
    "smoothright",
    "smoothup",
    "smoothdown",
    "circleopen",
    "circleclose",
    "vertopen",
    "vertclose",
    "horzopen",
    "horzclose",
    "dissolve",
    "pixelize",
    "diagtl",
    "diagtr",
    "diagbl",
    "diagbr",
    "hlslice",
    "hrslice",
    "vuslice",
    "vdslice",
    "hblur",
    "fadegrays",
    "wipetl",
    "wipetr",
    "wipebl",
    "wipebr",
    "squeezeh",
    "squeezev",
    "zoomin",
    "fadefast",
    "fadeslow",
    "hlwind",
    "hrwind",
    "vuwind",
    "vdwind",
    "coverleft",
    "coverright",
    "coverup",
    "coverdown",
    "revealleft",
    "revealright",
    "revealup",
    "revealdown",
  ];

  // join images with transition effects
  let previousOffset = 0;

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
      const effect =
        xfadeEffects[Math.floor(Math.random() * xfadeEffects.length)];
      const offset =
        videoConfigClip.duration + previousOffset - transitionDuration;
      previousOffset = offset;
      let transition = "";

      transition +=
        index === 0 ? "[0:v][1:v]" : `[vfade${index}][${index + 1}]`;
      transition += `xfade=transition=${effect}:duration=${transitionDuration}:offset=${offset}`;

      transition +=
        index === videoConfigClipChunk.length - 2
          ? ",format=yuv420p[video]"
          : `[vfade${index + 1}]`;

      return transition;
    })
    .join(";");

  await exec(
    `ffmpeg ${videoInputString} -filter_complex "${videoTransitions}" -movflags +faststart -map "[video]" -c:v h264_nvenc -preset p6 -preset fast -y "${mergedVideoPath}"`
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
  const mixAudioVideoCommand = `ffmpeg -i "${mergedVideoPath}" -i "${mergedAuidoPath}" -c:v copy -c:a copy -y "${outputFilePath}"`;
  await exec(mixAudioVideoCommand);
  return outputFilePath;
}

async function renderVideoClipConfig(videoConfigClip, screenSize, filePath) {
  await exec(
    `ffmpeg -loop 1 -framerate ${framerate}  -i "${videoConfigClip.clipImage.filePath}" \
     -t ${videoConfigClip.duration}  -vf "${createVideoEffect(videoConfigClip, framerate, screenSize)}" \
     -c:v h264_nvenc -preset p6 -y "${filePath}"`
  );
  videoConfigClip.videoFilePath = filePath;
}

function createSubtitles(videoConfigClips, storyVideoFolder, videoType) {
  const subtitleFontSize = subtitleFontSizes[videoType];
  const screenSize = sizeMapping[videoType];
  const subtitleYs = {
    standard: 0,
    short: screenSize.height - 700,
  };
  const subtitleY = subtitleYs[videoType];

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
  return assFilePath;
}

function splitArrayIntoChunks(array, chunkSplitLimit) {
  // split clips into chunks
  const chunkSize = Math.ceil(
    array.length / Math.ceil(array.length / chunkSplitLimit)
  );
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
async function createVideoClipConfigs(story, coverImageWithTitlePath) {
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
      effect: "zoomInFilter",
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
    videoConfigClip.effect = "movingCropFilter";
    videoConfigClip.imageSize = contentChunk.imageSize;
    videoConfigClips.push(videoConfigClip);
  }
  videoConfigClips.slice(-1)[0].duration += audioFadeOutDuration;
  return videoConfigClips;
}

async function addTitleToCoverImage(story, screenSize, storyTempFolder) {
  const titleFont = titleFonts[story.genre]
    ? titleFonts[story.genre]
    : titleFonts["default"];
  const titleFontColor = titleFontColors[story.genre]
    ? titleFontColors[story.genre]
    : titleFontColors["default"];

  const coverImagePath = story.coverImageFile || coverImages[story.videoType];

  registerFont(titleFont, { family: "Title font" });

  const canvas = createCanvas(screenSize.width, screenSize.height);
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
  return coverImageWithTitlePath;
}

function createVideoEffect(videoConfigClip, framerate, screenSize) {
  const zoomInRate = 0.0005;
  const scaleFactor = 1.3;
  const scaledWidth = Math.floor(screenSize.width * scaleFactor);
  const scaledHeight = Math.floor(screenSize.height * scaleFactor);

  const centerX = scaledWidth / 2 - screenSize.width / 2;
  const centerY = scaledHeight / 2 - screenSize.height / 2;
  const maxCropX = scaledWidth - screenSize.width;
  const maxCropY = scaledHeight - screenSize.height;

  const points = [];
  const pixelPerSecond = 60;

  const pixelPerFrame = pixelPerSecond / framerate;
  const totalPixels =
    pixelPerSecond * (videoConfigClip.duration - transitionDuration);

  const rad = Math.random() * 2 * Math.PI;

  let startX = centerX + Math.cos(rad) * totalPixels;
  startX = startX > maxCropX ? maxCropX : startX;
  startX = startX < 0 ? 0 : startX;

  let startY = maxCropY + Math.sin(rad) * totalPixels;
  startY = startY > maxCropY ? maxCropY : startY;
  startY = startY < 0 ? 0 : startY;

  points.push(
    {
      x: startX,
      y: startY,
      pixelPerFrame,
    },
    {
      x: centerX,
      y: centerY,
      pixelPerFrame,
    }
  );

  switch (videoConfigClip.effect) {
    case "movingCropFilter":
      return createMovingCropFilter(
        points,
        screenSize,
        videoConfigClip.imageSize || screenSize,
        scaleFactor,
        0
      );
    case "zoomInFilter":
      return createZoomInFilter(
        zoomInRate,
        framerate,
        videoConfigClip.duration,
        screenSize
      );
    default:
      return createScaleFilter(screenSize);
  }
}

function createScaleFilter(screenSize) {
  return `scale=${screenSize.width}x${screenSize.height}`;
}

function createZoomInFilter(zoomInRate, framerate, duration, screenSize) {
  return `scale=8000:-1,zoompan=z='min(1.50,zoom+${zoomInRate})':x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${duration * framerate}:s=${screenSize.width}x${screenSize.height}:fps=${framerate}`;
}

function createMovingCropFilter(
  points,
  screenSize,
  imageSize,
  scaleFactor,
  startFrame = 0
) {
  const scaledWidth = Math.floor(imageSize.width * scaleFactor);
  const scaledHeight = Math.floor(imageSize.height * scaleFactor);
  const movingCropFilterXY = createMovingCropFilterXY(points, startFrame);
  return `scale=${scaledWidth}x${scaledHeight}, crop='${screenSize.width}:${screenSize.height}:${movingCropFilterXY.x}:${movingCropFilterXY.y}'`;
}

function createMovingCropFilterXY(points, startFrame = 0) {
  if (points.length === 1) {
    return { x: points[0].x, y: points[0].y };
  }

  const { x: startX, y: startY, pixelPerFrame } = points[0];
  const { x: endX, y: endY } = points[1];
  const distance = Math.sqrt((startX - endX) ** 2 + (startY - endY) ** 2);
  const numberFrames = Math.ceil(distance / pixelPerFrame);

  const radSin = Math.asin((endX - startX) / distance);
  const pixelPerFrameX = -Math.sin(radSin) * pixelPerFrame;
  const radCos = Math.acos((endY - startY) / distance);
  const pixelPerFrameY = -Math.cos(radCos) * pixelPerFrame;

  const nextYX = createMovingCropFilterXY(
    points.slice(1),
    startFrame + numberFrames
  );

  return {
    x: `if(between(n,${startFrame},${startFrame + numberFrames}),${startX}${pixelPerFrameX > 0 ? `-${pixelPerFrameX}` : `+${0 - pixelPerFrameX}`}*(n -${startFrame}), ${nextYX.x})`,
    y: `if(between(n,${startFrame},${startFrame + numberFrames}),${startY}${pixelPerFrameY > 0 ? `-${pixelPerFrameY}` : `+${0 - pixelPerFrameY}`}*(n- ${startFrame}), ${nextYX.y})`,
  };
}

if (require.main === module && process.argv[2]) {
  renderVideo(process.argv[2]);
}

exports.renderVideo = renderVideo;
