const fs = require("fs");
const path = require("path");
const { createFolderIfNotExist, splitArrayIntoChunks } = require("./utils");
const util = require("util");
const { observable, when, runInAction } = require("mobx");
const exec = util.promisify(require("child_process").exec);
const { getAudioDurationInSeconds } = require("get-audio-duration");
const { createCanvas, loadImage, registerFont } = require("canvas");
const { batchGenerateTranscripts } = require("./resources_utils");
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
  const storyFolder = createFolderIfNotExist("G:/videos", topic);
  const storyVideoFolder = createFolderIfNotExist(storyFolder, "videos");
  const storyTempFolder = createFolderIfNotExist(storyVideoFolder, "temp");
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  let story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));

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

  // Render each video clip concurrently

  const gpus = observable([
    { limit: 3, current: 0 },
    { limit: 4, current: 0 },
  ]);
  const rendingClipPromises = [];
  for (let index = 0; index < videoConfigClips.length; index++) {
    await when(() => gpus.some((gpu) => gpu.limit > gpu.current));
    const availableGpu = gpus.findIndex((gpu) => gpu.limit > gpu.current);
    const mergedVideoPath = path.resolve(
      storyTempFolder,
      `temp_merged_video_${index + 1}.mkv`
    );
    console.log(
      `Rendering clip ${index + 1}/${videoConfigClips.length} using gpu ${availableGpu}`
    );
    const videoConfigClip = videoConfigClips[index];
    runInAction(() => {
      gpus[availableGpu].current++;
    });
    const createCurrentRenderingPromise = async () => {
      try {
        await renderVideoClipConfig(
          videoConfigClip,
          screenSize,
          mergedVideoPath,
          framerate,
          availableGpu
        );
      } catch (ex) {
        console.log(ex);
        throw ex;
      }
    };

    rendingClipPromises.push(
      createCurrentRenderingPromise().then(() =>
        runInAction(() => {
          gpus[availableGpu].current--;
        })
      )
    );
  }
  await Promise.all(rendingClipPromises);

  // Generate videos based on videoConfigClips by chunks to avoid ffmpng commands being too long
  const audioVideoPaths = [];

  // split clips into chunks
  const chunkSplitLimit = 30;
  const videoConfigClipChunks = splitArrayIntoChunks(
    videoConfigClips,
    chunkSplitLimit
  );
  console.log(`Creating video chunk`);

  const rendingClipChunkPromises = [];
  for (let index = 0; index < videoConfigClipChunks.length; index++) {
    await when(() => gpus.some((gpu) => gpu.limit > gpu.current));
    const availableGpu = gpus.findIndex((gpu) => gpu.limit > gpu.current);
    console.log(
      `Creating video chunk ${index + 1}/${videoConfigClipChunks.length} using gpuy ${availableGpu}`
    );

    const audioVideoPath = path.resolve(
      storyTempFolder,
      `video_audio_${index}.mkv`
    );
    const createCurrentRenderingPromise = async () => {
      try {
        await renderVideoClipChunk(
          videoConfigClipChunk,
          audioVideoPath,
          availableGpu
        );
        audioVideoPaths[index] = audioVideoPath;
      } catch (ex) {
        console.log(ex);
        throw ex;
      }
    };

    const videoConfigClipChunk = videoConfigClipChunks[index];
    runInAction(() => {
      gpus[availableGpu].current++;
    });

    rendingClipChunkPromises.push(
      createCurrentRenderingPromise().then(() =>
        runInAction(() => {
          gpus[availableGpu].current--;
        })
      )
    );
  }
  await Promise.all(rendingClipChunkPromises);

  // merge video_aduio chunchs
  console.log(`Merging video with audio`);
  const videoList = audioVideoPaths
    .map((audioVideoPath) => `file '${audioVideoPath}'`)
    .join("\n");
  const videoListPath = path.resolve(storyTempFolder, `video_list.txt`);
  fs.writeFileSync(videoListPath, videoList);

  // creating auido and subtitles
  const createAssFile = async () => {
    console.log("Creating auido and subtitles");
    const finalAudioPath = path.resolve(storyVideoFolder, `audio.ogg`);
    await exec(
      `ffmpeg -safe 0 -f concat -i "${videoListPath}" -vn -map_metadata -1 -ac 1 -c:a libopus -b:a 12k -application voip -y "${finalAudioPath}`
    );
    console.log("Extracting transcript");
    const transcript = (await batchGenerateTranscripts([finalAudioPath], 0))[0];
    const words = transcript.flatMap((segment) => segment.words);
    const assFilePath = createSubtitles(
      words,
      storyVideoFolder,
      story.videoType
    );
    return assFilePath;
  };

  const creatingAssFilePromise = createAssFile();

  // merge video chunks
  console.log("Merge video chunks");
  const mergedVideoPath = path.resolve(storyTempFolder, `merged_video.mkv`);
  await exec(
    `ffmpeg -safe 0 -f concat -i "${videoListPath}" -c copy -y "${mergedVideoPath}"`
  );

  //Mix merged videos with bgm
  console.log(`Mix videos with bgm`);
  const finalVideoPath = path.resolve(storyVideoFolder, `video.mkv`);
  const totalDuration = videoConfigClips.reduce(
    (totalDuration, videoConfigClip) =>
      videoConfigClip.duration + totalDuration,
    0
  );

  const assFilePath = await creatingAssFilePromise;
  console.log("Creating final video");
  await exec(
    `ffmpeg -i "${mergedVideoPath}" -stream_loop -1 -i "${bgm}" -i "${assFilePath}" -filter_complex "[0:a][1:a] amix=inputs=2:duration=first[aout];[aout]afade=type=out:duration=${audioFadeOutDuration}:start_time=${totalDuration - audioFadeOutDuration}[afinal]" -c:v copy -c:a aac -c:s copy -map 0:v -map "[afinal]" -map 2:s  -y "${finalVideoPath}"`
  );

  story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  story.videoFilePath = finalVideoPath;
  story.hasVideo = true;

  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
  await exec(`rmdir /s /Q "${storyTempFolder}"`);
  console.log("time elapsed:", (Date.now() - current) / 60000);
}

async function renderVideoClipChunk(videoConfigClipChunk, outputFilePath, gpu) {
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
        index === 0 ? "[0:v][1:v]" : `[vfade${index}][${index + 1}:v]`;
      transition += `xfade=transition=${effect}:duration=${transitionDuration}:offset=${offset}`;

      transition +=
        index === videoConfigClipChunk.length - 2
          ? ",format=yuv420p[video]"
          : `[vfade${index + 1}]`;

      return transition;
    })
    .join(";");
  const audioTransitions = videoConfigClipChunk
    .map((videoConfigClip, index) => {
      if (videoConfigClipChunk.length - 1 === index) return "";
      let transition = "";
      transition += index === 0 ? "[0:a][1:a]" : `[a${index}][${index + 1}:a]`;
      transition += `acrossfade=d=${transitionDuration}:c1=tri:c2=tri`;

      transition +=
        index === videoConfigClipChunk.length - 2
          ? "[audio]"
          : `[a${index + 1}]`;

      return transition;
    })
    .join(";");

  // join video with audio
  await exec(
    `ffmpeg -hwaccel_device ${gpu} -hwaccel cuda ${videoInputString} -filter_complex "${audioTransitions}${videoTransitions}" -map "[video]" -map [audio] -c:a aac -c:v h264_nvenc -preset p6 -y "${outputFilePath}"`
  );
  return outputFilePath;
}

async function renderVideoClipConfig(
  videoConfigClip,
  screenSize,
  filePath,
  framerate,
  availableGpu
) {
  const audioConfig = videoConfigClip.audioConfig;
  const videoDuration = videoConfigClip.duration;
  let silencePaddingAfter =
    videoDuration - audioConfig.startTime - audioConfig.duration;
  silencePaddingAfter = silencePaddingAfter > 0 ? silencePaddingAfter : 0.01;
  const audioInput = `-f lavfi -t "${audioConfig.startTime}" -i anullsrc=channel_layout=stereo:sample_rate=44100 -i "${audioConfig.filePath}" -t "${audioConfig.duration}" -f lavfi -t "${silencePaddingAfter.toFixed(2)}" -i anullsrc=channel_layout=stereo:sample_rate=44100`;
  const videopInput = `-loop 1 -framerate ${framerate} -i "${videoConfigClip.clipImage.filePath}" -t "${videoDuration}"`;
  await exec(
    `ffmpeg -hwaccel_device ${availableGpu} -hwaccel cuda ${videopInput} ${audioInput}  \
    -filter_complex "[0:v]${createVideoEffect(videoConfigClip, framerate, screenSize)}[v];[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]" \
    -shortest -pix_fmt yuv420p -c:v h264_nvenc -c:a aac -map "[v]" -map "[a]" -preset p6 -y "${filePath}"`
  );
  videoConfigClip.videoFilePath = filePath;
}

function createSubtitles(words, storyVideoFolder, videoType) {
  const subtitleFontSize = subtitleFontSizes[videoType];
  const screenSize = sizeMapping[videoType];
  const subtitleYs = {
    standard: 0,
    short: screenSize.height - 700,
  };
  const subtitleY = subtitleYs[videoType];

  const clipWords = [];
  const wordCountLimit = 6;
  const individualWords = words.map((word) => word.word);
  const numberOfChunks = Math.ceil(individualWords.length / wordCountLimit);
  const chunkSize = Math.ceil(individualWords.length / numberOfChunks);

  words.forEach((word, innerIndex) => {
    const wordChunkStart = Math.floor(innerIndex / chunkSize) * chunkSize;
    let wordChunkEnd = (Math.floor(innerIndex / chunkSize) + 1) * chunkSize + 1;
    wordChunkEnd =
      wordChunkEnd > individualWords.length
        ? individualWords.length
        : wordChunkEnd;
    word.words = individualWords.slice(wordChunkStart, wordChunkEnd);
    word.end =
      innerIndex < words.length - 1 ? words[innerIndex + 1].start : word.end;
    word.innerIndex = innerIndex - wordChunkStart;
  });
  clipWords.push(...words);

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
  const assFilePath = path.resolve(storyVideoFolder, `subtitle.ass`);
  fs.writeFileSync(assFilePath, assFile);
  return assFilePath;
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
      effect: null,
    },
  ];

  for (let contentChunk of story.contentChunks) {
    const videoConfigClip = {};
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

    // add the clip config
    videoConfigClip.audioConfig = audioConfig;
    videoConfigClip.clipImage = clipImage;
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
  let titleSegments = [story.title];

  let currentSplitCount = 1;
  while (
    titleSegments
      .map((titleSegment) => ctx.measureText(titleSegment).width)
      .some((width) => width > canvas.width)
  ) {
    titleSegments = [];
    currentSplitCount++;
    const titleparts = story.title.split(" ");
    const chunkSize = titleparts.length / currentSplitCount;
    for (let i = 0; i < titleparts.length; i += chunkSize) {
      titleSegments.push(titleparts.slice(i, i + chunkSize).join(" "));
    }
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
  const scaleFactor = 1.2;
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
exports.createVideoClipConfigs = createVideoClipConfigs;
