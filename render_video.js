const fs = require("fs");
const path = require("path");
const {
  createFolderIfNotExist,
  splitArrayIntoChunks,
  executeExternalHelper,
} = require("./utils");
const util = require("util");
const { observable, when, runInAction } = require("mobx");
const exec = util.promisify(require("child_process").exec);
const { getAudioDurationInSeconds } = require("get-audio-duration");
const { getVideoDurationInSeconds } = require('get-video-duration');
const { batchGenerateTranscripts } = require("./resources_utils");
const {
  sizeMapping,
  genreBGM,
  titleFonts,
  titleFontColors,
  coverImages,
  subtitleFontSizes,
  titleFontSizes,
  clipGappingTime,
  framerate,
  transitionDuration,
  audioFadeOutDuration,
  subtitleYs,
  screenSizeMapping,
} = require("./config");

async function renderVideo(topic) {
  const current = Date.now();
  const storyFolder = createFolderIfNotExist(__dirname, "videos", topic);
  const storyVideoFolder = createFolderIfNotExist(storyFolder, "videos");
  const storyTempFolder = createFolderIfNotExist(storyVideoFolder, "temp");
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  let story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));

  const videoSize = sizeMapping["standard"];
  if (!videoSize) {
    return "Please add videoSize";
  }

  const bgm =
    story.bgmFile || genreBGM[story.genre];

  console.log("Using bgm:", bgm);

  // Handle cover-only videos
  if (story.coverOnly) {
    console.log("Rendering cover-only video");
    return await renderCoverOnlyVideo(story, storyFolder, storyVideoFolder, storyTempFolder, videoSize, bgm, topic);
  }

  let videoConfigClips = await createVideoClipConfigs(story);
  videoConfigClips = await preprocessConfigClips(
    videoConfigClips,
    storyTempFolder
  );

  const totalDuration = videoConfigClips.reduce(
    (totalDuration, videoConfigClip) =>
      videoConfigClip.duration + totalDuration,
    0
  );
  story.videoType = totalDuration < 60 ? "short" : "standard";

  // Render each video clip concurrently

  let gpus = observable([
    { limit: 3, current: 0 },
    { limit: 3, current: 0 },
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
          videoSize,
          mergedVideoPath,
          framerate,
          availableGpu,
          storyTempFolder
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
  gpus = observable([
    { limit: 2, current: 0 },
    { limit: 2, current: 0 },
  ]);
  const rendingClipChunkPromises = [];
  for (let index = 0; index < videoConfigClipChunks.length; index++) {
    await when(() => gpus.some((gpu) => gpu.limit > gpu.current));
    const availableGpu = gpus.findIndex((gpu) => gpu.limit > gpu.current);
    console.log(
      `Creating video chunk ${index + 1}/${videoConfigClipChunks.length} using gpu ${availableGpu}`
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

  // Batch generate transcripts for all chunks at once
  console.log("Generating transcriptions for all chunks");
  const transcripts = await batchGenerateTranscripts(audioVideoPaths, 0);

  // Create ASS files and apply subtitles to each chunk
  console.log("Creating ASS subtitle files and applying to video chunks");
  const subtitledVideoPaths = [];
  for (let index = 0; index < transcripts.length; index++) {
    console.log(`Processing subtitles for chunk ${index + 1}/${transcripts.length}`);

    // Extract words from transcript
    let words = transcripts[index].flatMap((segment) => segment.words);

    // Filter words for title if this is the first chunk and title is not skipped
    if (index === 0 && !story.skipTitle) {
      words = words.filter((word) => word.end > story.titleAudioDuration + 0.2);
    }

    // Create ASS file for this chunk
    const chunkAssFilePath = path.resolve(
      storyTempFolder,
      `subtitle_chunk_${index}.ass`
    );
    createSubtitles(words, chunkAssFilePath, story.videoType);

    // Create temp ASS link for this chunk
    const tempAssLinkPath = `./temp/temp_${index}.ass`;
    fs.copyFileSync(chunkAssFilePath, tempAssLinkPath);

    // Properly escape backslashes for ASS filter (Windows requires double backslashes)
    const assFilterPath = tempAssLinkPath.replace(/\\/g, '\\\\\\\\');

    // Apply subtitles to video chunk
    const subtitledVideoPath = path.resolve(
      storyTempFolder,
      `video_audio_subtitled_${index}.mkv`
    );
    await exec(
      `ffmpeg -i "${audioVideoPaths[index]}" -vf "ass='${assFilterPath}'" -c:v libx264 -c:a copy -y "${subtitledVideoPath}"`
    );

    subtitledVideoPaths[index] = subtitledVideoPath;
    fs.unlinkSync(tempAssLinkPath); // Clean up temp ASS file
  }

  // merge video_audio chunks with subtitles
  console.log(`Merging video chunks with subtitles`);
  const videoList = subtitledVideoPaths
    .map((videoPath) => `file '${videoPath.replace(/'/g, "'\\''")}'`)
    .join("\n");
  const videoListPath = path.resolve(storyTempFolder, `video_list.txt`);
  fs.writeFileSync(videoListPath, videoList);

  const mergedVideoPath = path.resolve(storyTempFolder, `merged_video.mkv`);
  await exec(
    `ffmpeg -safe 0 -f concat -i "${videoListPath}" -c copy -y "${mergedVideoPath}"`
  );

  //Mix merged videos with bgm
  console.log(`Mix videos with bgm`);
  const finalVideoPath = path.resolve(storyVideoFolder, `${topic}.mkv`);


  console.log("Creating final video with BGM and padding");
  const screenSize = screenSizeMapping[story.videoType];
  if (bgm) {
    await exec(
      `ffmpeg -i "${mergedVideoPath}" -stream_loop -1 -i "${bgm}" -f lavfi -t "${videoConfigClips[0].duration}" -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex "[0:v]${createPaddingFilter(screenSize)}[v];[2:a][1:a]concat=n=2:v=0:a=1[aout];[0:a][aout] amix=inputs=2:duration=first[aout];[aout]afade=type=out:duration=${audioFadeOutDuration}:start_time=${totalDuration - audioFadeOutDuration}[afinal]" -c:v libx264 -c:a libopus -b:a 128k -map [v] -map "[afinal]"  -y "${finalVideoPath}"`
    );
  } else {
    await exec(
      `ffmpeg -i "${mergedVideoPath}" -filter_complex "[0:v]${createPaddingFilter(screenSize)}[v];[0:a]afade=type=out:duration=${audioFadeOutDuration}:start_time=${totalDuration - audioFadeOutDuration}[afinal]" -c:v libx264 -c:a libopus -b:a 128k -map [v] -map "[afinal]"  -y "${finalVideoPath}"`
    );
  }


  story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  story.videoFilePath = finalVideoPath;
  story.hasVideo = true;

  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
  //await exec(`rmdir /s /Q "${storyTempFolder}"`);
  console.log("time elapsed:", (Date.now() - current) / 60000);
}

async function renderVideoClipChunk(videoConfigClipChunk, outputFilePath, gpu) {
  const xfadeEffects = [
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
    `ffmpeg ${videoInputString} -filter_complex "${audioTransitions}${videoTransitions}" -r ${framerate} -map "[video]" -map [audio] -c:a libopus -b:a 128k -c:v libx264 -y "${outputFilePath}"`
  );
  return outputFilePath;
}

async function renderVideoClipConfig(
  videoConfigClip,
  videoSize,
  filePath,
  framerate,
  availableGpu,
  storyTempFolder
) {
  const audioConfig = videoConfigClip.audioConfig;
  const videoDuration = videoConfigClip.duration;
  const audioInput = `-i "${audioConfig.filePath}"`;

  // For videos, we'll handle stretching in the filter if needed
  const videopInput = `${videoConfigClip.clipImage.enableVideo ? "" : `-loop 1 -framerate ${framerate}`}  -i "${videoConfigClip.clipImage.filePath}"${!videoConfigClip.clipImage.enableVideo ? ` -t "${videoDuration}"` : ""}`;

  const overlay = videoConfigClip.overlayFile
    ? `-stream_loop -1 -i "${videoConfigClip.overlayFile}"`
    : "";

  // If video is enabled, we need to check its duration and stretch if shorter than audio
  let videoFilterPrefix = "";
  if (videoConfigClip.clipImage.enableVideo) {
    const originalVideoDuration = await getVideoDurationInSeconds(videoConfigClip.clipImage.filePath);
    console.log(`Original video duration: ${originalVideoDuration}, target duration: ${videoDuration}`);
    if (originalVideoDuration < videoDuration) {
      // Video is shorter than audio, need to stretch it by slowing down playback
      const speedFactor = videoDuration / originalVideoDuration;
      // Use setpts to slow down and minterpolate for smooth frame interpolation
      videoFilterPrefix = `setpts=${speedFactor}*PTS,`;
    } else {
      // Video is longer or equal, trim it to match audio duration
      videoFilterPrefix = `trim=duration=${videoDuration},setpts=PTS-STARTPTS,`;
    }
  }

  await exec(
    `ffmpeg ${videopInput} ${audioInput} ${overlay}  \
    -filter_complex "[0:v]${videoFilterPrefix}${createVideoEffect(videoConfigClip, framerate, videoSize)}[v]${overlay ? ";[2]format=yuva444p,colorchannelmixer=aa=0.1[overlay];[overlay][v]scale2ref[overlay][main];[main][overlay]overlay[v]" : ""}" \
    -r ${framerate} -t "${videoDuration}" -pix_fmt yuv420p -c:v libx264 -c:a libopus -b:a 128k -map "[v]" -map 1 -y "${filePath}"`
  );

  if (videoConfigClip.title) {
    const tempFile = path.resolve(storyTempFolder, "temp.mkv");
    await executeExternalHelper("python moving_text.py", {
      text: videoConfigClip.title,
      width: videoSize.width,
      height: videoSize.height,
      duration: videoConfigClip.duration,
      fontSize: videoConfigClip.fontSize,
      font: videoConfigClip.font,
      fontColor: videoConfigClip.fontColor,
      outputFilePath: tempFile,
      videoPath: filePath,
      framerate,
    });
    fs.copyFileSync(tempFile, filePath);
  }
  videoConfigClip.videoFilePath = filePath;
}
function createSubtitles(words, assFilePath, videoType) {
  const subtitleFontSize = subtitleFontSizes[videoType];
  const marginV = subtitleYs[videoType];

  const clipWords = [];

  // Different word grouping for standard vs short videos
  const wordCountLimit = videoType === 'standard' ? 10 : 1;
  const individualWords = words.map((word) => word.word);
  const numberOfChunks = Math.ceil(individualWords.length / wordCountLimit);
  const chunkSize = Math.ceil(individualWords.length / numberOfChunks);

  words.forEach((word, innerIndex) => {
    const wordChunkStart = Math.floor(innerIndex / chunkSize) * chunkSize;
    let wordChunkEnd = Math.ceil(innerIndex / chunkSize) * chunkSize + 1;
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

    // Only highlight current word for short videos
    words[innerIndex] = `{\\c&H00FFFF&}${words[innerIndex]}{\\c&HFFFFFF&}`;

    return `Dialogue: 0,${new Date(word.start * 1000).toISOString().slice(12, -2)},${new Date(word.end * 1000).toISOString().slice(12, -2)},Default,,0,0,0,,${words.join("")}`;
  });

  // Get screen dimensions for proper positioning
  const screenSize = screenSizeMapping[videoType];
  const playResX = screenSize.width;
  const playResY = screenSize.height;

  // For standard videos, center vertically (alignment 2 = bottom center, but we'll adjust margin)
  // For short videos, keep at bottom
  const alignment = videoType === 'standard' ? 2 : 2; // 2 = bottom center

  const assFile = `[Script Info]
; Script generated by Aegisub 3.2.2
; http://www.aegisub.org/
Title: Default Aegisub file
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${subtitleFontSize},&H00FFFFFF,&H00FFFFFF,&HBB999999,&HAA777777,0,0,0,0,100,100,0,0,1,10,2,${alignment},10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${subtitles.join("\n")}
    `;
  fs.writeFileSync(assFilePath, assFile);
  return assFilePath;
}
async function preprocessConfigClips(videoConfigClips, storyTempFolder) {
  for (let videoConfigClip of videoConfigClips) {
    if (videoConfigClip.transitionSound) {
      const audioWithTransitionSoundFolder = createFolderIfNotExist(
        storyTempFolder,
        "audiosWithTransitionSound"
      );
      const audioWithTransitionSound = path.resolve(
        audioWithTransitionSoundFolder,
        path.basename(videoConfigClip.audioConfig.filePath)
      );
      await exec(
        `ffmpeg -i "${videoConfigClip.audioConfig.filePath}" -i "${videoConfigClip.transitionSound}" -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[outa]" -map "[outa]"  -y "${audioWithTransitionSound}"`
      );
      videoConfigClip.audioConfig.filePath = audioWithTransitionSound;
    }

    const audioWithPaddingFolder = createFolderIfNotExist(
      storyTempFolder,
      "audioWithPadding"
    );
    const audioWithPadding = path.resolve(
      audioWithPaddingFolder,
      path.basename(videoConfigClip.audioConfig.filePath)
    );

    await exec(
      `ffmpeg  -i "${videoConfigClip.audioConfig.filePath}" -f lavfi -t "${videoConfigClip.audioConfig.startTime}" -i anullsrc=channel_layout=stereo:sample_rate=44100 -f lavfi -t "${videoConfigClip.audioConfig.paddingTime}" -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex "[1:a][0:a][2:a]concat=n=3:v=0:a=1[outa]" -map "[outa]"  -y "${audioWithPadding}"`
    );
    videoConfigClip.audioConfig.filePath = audioWithPadding;

    videoConfigClip.duration = await getAudioDurationInSeconds(
      videoConfigClip.audioConfig.filePath
    );
  }

  return videoConfigClips;
}

async function createVideoClipConfigs(story) {
  //Create title clip
  const fontSize = titleFontSizes["short"];
  const titleFont = titleFonts[story.genre]
    ? titleFonts[story.genre]
    : titleFonts["default"];
  const titleFontColor = titleFontColors[story.genre]
    ? titleFontColors[story.genre]
    : titleFontColors["default"];
  const coverVideoExists =
    story.coverVideoFile && fs.existsSync(story.coverVideoFile);
  const titleAudioDuration = story.skipTitle ? 0 :
    (story.titleAudioDuration ||
      (await getAudioDurationInSeconds(story.titleAudio)));
  const videoConfigClips = story.skipTitle ? []
    : [
      {
        audioConfig: {
          startTime: clipGappingTime * 2,
          paddingTime: story.transitionSound ? 0.001 : clipGappingTime,
          filePath: story.titleAudio,
          duration: titleAudioDuration,
        },
        clipImage: {
          filePath: coverVideoExists
            ? story.coverVideoFile
            : story.coverImageFile,
          duration: titleAudioDuration + 2,
          enableVideo: !!story.coverVideoFile,
        },
        clipWords: [],
        duration: titleAudioDuration + 2,
        effect: "",
        title: story.title,
        fontSize: fontSize,
        font: titleFont,
        fontColor: titleFontColor,
        overlayFile: story.overlayFile,
        transitionSound: story.transitionSound,
      },
    ];

  for (let contentChunk of story.contentChunks) {
    const videoConfigClip = {};
    const audioDuration =
      contentChunk.audioDuration ||
      (await getAudioDurationInSeconds(contentChunk.audioFile));
    contentChunk.audioDuration = audioDuration;
    videoConfigClip.transitionSound =
      contentChunk.transitionSound || story.transitionSound;
    const audioConfig = {
      startTime: clipGappingTime,
      paddingTime: videoConfigClip.transitionSound ? 0.001 : clipGappingTime,
      filePath: contentChunk.audioFile,
      duration: audioDuration,
    };
    const videoFileExists =
      contentChunk.sceneVideoFile && fs.existsSync(contentChunk.sceneVideoFile);
    const clipImage = {
      filePath: videoFileExists
        ? contentChunk.sceneVideoFile
        : contentChunk.sceneImageFile,
      duration:
        audioDuration +
        audioConfig.startTime +
        audioConfig.paddingTime +
        (videoConfigClip.transitionSound
          ? await getAudioDurationInSeconds(videoConfigClip.transitionSound)
          : 0),
      enableVideo: videoFileExists,
    };

    // add the clip config
    videoConfigClip.audioConfig = audioConfig;
    videoConfigClip.clipImage = clipImage;
    videoConfigClip.duration = clipImage.duration;
    videoConfigClip.effect = clipImage.enableVideo ? "" : "movingCropFilter";
    videoConfigClip.imageSize = contentChunk.imageSize;
    videoConfigClip.overlayFile =
      contentChunk.overlayFile === undefined
        ? story.overlayFile
        : contentChunk.overlayFile;

    videoConfigClips.push(videoConfigClip);
  }
  videoConfigClips.slice(-1)[0].duration += audioFadeOutDuration;
  videoConfigClips.slice(-1)[0].audioConfig.paddingTime = audioFadeOutDuration;
  delete videoConfigClips.slice(-1)[0].transitionSound;
  return videoConfigClips;
}

function createVideoEffect(videoConfigClip, framerate, videoSize) {
  const zoomInRate = 0.0005;
  const scaleFactor = 1.1;
  const scaledWidth = Math.floor(videoSize.width * scaleFactor);
  const scaledHeight = Math.floor(videoSize.height * scaleFactor);

  const centerX = scaledWidth / 2 - videoSize.width / 2;
  const centerY = scaledHeight / 2 - videoSize.height / 2;
  const maxCropX = scaledWidth - videoSize.width;
  const maxCropY = scaledHeight - videoSize.height;

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
        videoSize,
        videoConfigClip.imageSize || videoSize,
        scaleFactor,
        0
      );
    case "zoomInFilter":
      return createZoomInFilter(
        zoomInRate,
        framerate,
        videoConfigClip.duration,
        videoSize
      );
    case "scaleFilter":
      return createScaleFilter(
        zoomInRate,
        framerate,
        videoConfigClip.duration,
        videoSize
      );
    default:
      return "null";
  }
}

function createScaleFilter(videoSize) {
  return `scale=${videoSize.width}x${videoSize.height}`;
}

function createZoomInFilter(zoomInRate, framerate, duration, videoSize) {
  return `scale=8000:-1,zoompan=z='min(1.50,zoom+${zoomInRate})':x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=${duration * framerate}:s=${videoSize.width}x${videoSize.height}:fps=${framerate}`;
}

function createPaddingFilter(screenSize) {
  return `scale=${screenSize.width}:${screenSize.height}:force_original_aspect_ratio=decrease,pad=${screenSize.width}:${screenSize.height}:-1:-1:color=black`;
}

function createMovingCropFilter(
  points,
  videoSize,
  imageSize,
  scaleFactor,
  startFrame = 0
) {
  const scaledWidth = Math.floor(imageSize.width * scaleFactor);
  const scaledHeight = Math.floor(imageSize.height * scaleFactor);
  const movingCropFilterXY = createMovingCropFilterXY(points, startFrame);
  return `scale=${scaledWidth}x${scaledHeight}, crop='${videoSize.width}:${videoSize.height}:${movingCropFilterXY.x}:${movingCropFilterXY.y}'`;
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

async function renderCoverOnlyVideo(story, storyFolder, storyVideoFolder, storyTempFolder, videoSize, bgm, topic) {
  // Create audio file by concatenating all audio chunks
  const audioFiles = [];

  // Add title audio if not skipped
  if (!story.skipTitle && story.titleAudio) {
    audioFiles.push(story.titleAudio);
  }

  // Add all content chunk audio files
  for (const contentChunk of story.contentChunks) {
    if (contentChunk.audioFile) {
      audioFiles.push(contentChunk.audioFile);
    }
  }

  // Create audio list file for concatenation
  const audioList = audioFiles.map(audioFile => `file '${audioFile}'`).join('\n');
  const audioListPath = path.resolve(storyTempFolder, 'audio_list.txt');
  fs.writeFileSync(audioListPath, audioList);

  // Concatenate all audio files - re-encode to ensure compatibility
  const concatenatedAudioPath = path.resolve(storyTempFolder, 'concatenated_audio.ogg');
  await exec(`ffmpeg -safe 0 -f concat -i "${audioListPath}" -c:a libopus -b:a 128k -ar 48000 -ac 2 -y "${concatenatedAudioPath}"`);

  // Get total duration from concatenated audio
  const totalDuration = await getAudioDurationInSeconds(concatenatedAudioPath);
  console.log("Total video duration:", totalDuration);

  // Update story with video type based on duration
  story.videoType = totalDuration < 60 ? "short" : "standard";

  // Determine cover image/video to use
  const coverVideoExists = story.coverVideoFile && fs.existsSync(story.coverVideoFile);
  const coverFilePath = coverVideoExists ? story.coverVideoFile : story.coverImageFile;
  const isVideo = coverVideoExists;

  // Create video with cover image/video for entire duration
  const tempVideoPath = path.resolve(storyTempFolder, 'cover_video.mkv');

  // Check if overlay file exists and should be applied
  const hasOverlay = story.overlayFile && fs.existsSync(story.overlayFile);
  const overlayInput = hasOverlay ? `-stream_loop -1 -i "${story.overlayFile}"` : "";

  console.log("Rendering video with cover");
  if (isVideo) {
    // For video files, loop the video
    if (hasOverlay) {
      await exec(
        `ffmpeg -stream_loop -1 -i "${coverFilePath}" -i "${concatenatedAudioPath}" ${overlayInput} -t "${totalDuration}" -filter_complex "[2]format=yuva444p,colorchannelmixer=aa=0.1[overlay];[overlay][0:v]scale2ref[overlay][main];[main][overlay]overlay[v]" -map "[v]" -map 1:a -c:v libx264 -c:a libopus -b:a 128k -r ${framerate} -pix_fmt yuv420p -shortest -y "${tempVideoPath}"`
      );
    } else {
      await exec(
        `ffmpeg -stream_loop -1 -i "${coverFilePath}" -i "${concatenatedAudioPath}" -t "${totalDuration}" -c:v libx264 -c:a libopus -b:a 128k -r ${framerate} -pix_fmt yuv420p -shortest -y "${tempVideoPath}"`
      );
    }
  } else {
    // For image files, create static video without effects
    if (hasOverlay) {
      await exec(
        `ffmpeg -loop 1 -framerate ${framerate} -i "${coverFilePath}" -i "${concatenatedAudioPath}" ${overlayInput} -t "${totalDuration}" -filter_complex "[0:v]scale=${videoSize.width}:${videoSize.height}[v];[2]format=yuva444p,colorchannelmixer=aa=0.1[overlay];[overlay][v]scale2ref[overlay][main];[main][overlay]overlay[v]" -map "[v]" -map 1:a -c:v libx264 -c:a libopus -b:a 128k -r ${framerate} -pix_fmt yuv420p -shortest -y "${tempVideoPath}"`
      );
    } else {
      await exec(
        `ffmpeg -loop 1 -framerate ${framerate} -i "${coverFilePath}" -i "${concatenatedAudioPath}" -t "${totalDuration}" -filter_complex "[0:v]scale=${videoSize.width}:${videoSize.height}[v]" -map "[v]" -map 1:a -c:v libx264 -c:a libopus -b:a 128k -r ${framerate} -pix_fmt yuv420p -shortest -y "${tempVideoPath}"`
      );
    }
  }

  // Add title overlay if not skipped
  if (!story.skipTitle && story.title) {
    console.log("Rendering title");

    const fontSize = titleFontSizes["short"];
    const titleFont = titleFonts[story.genre] ? titleFonts[story.genre] : titleFonts["default"];
    const titleFontColor = titleFontColors[story.genre] ? titleFontColors[story.genre] : titleFontColors["default"];
    const titleDuration = story.titleAudioDuration || await getAudioDurationInSeconds(story.titleAudio);

    const tempTitleVideoPath = path.resolve(storyTempFolder, 'cover_video_with_title.mkv');
    await executeExternalHelper("python moving_text.py", {
      text: story.title,
      width: videoSize.width,
      height: videoSize.height,
      duration: titleDuration,
      fontSize: fontSize,
      font: titleFont,
      fontColor: titleFontColor,
      outputFilePath: tempTitleVideoPath,
      videoPath: tempVideoPath,
      framerate,
    });
    fs.copyFileSync(tempTitleVideoPath, tempVideoPath);
  }

  // Create subtitles
  console.log("Creating subtitles for cover-only video");
  const transcript = (await batchGenerateTranscripts([concatenatedAudioPath], 0))[0];
  let words = transcript.flatMap((segment) => segment.words);

  if (!story.skipTitle && story.titleAudioDuration) {
    // Remove title from the subtitle
    words = words.filter((word) => word.end > story.titleAudioDuration + 0.2);
  }

  const assFilePath = createSubtitles(
    words,
    path.resolve(storyVideoFolder, 'subtitle.ass'),
    story.videoType
  );

  // Create final video with subtitles and background music
  const finalVideoPath = path.resolve(storyVideoFolder, `${topic}.mkv`);
  const screenSize = screenSizeMapping[story.videoType];

  // Workaround for difficult ass filter
  const tempAssLink = "./temp/temp.ass";
  fs.copyFileSync(assFilePath, tempAssLink);
  if (bgm) {
    console.log("Creating final cover-only video with BGM and subtitles");
    await exec(
      `ffmpeg -i "${tempVideoPath}" -stream_loop -1 -i "${bgm}" -f lavfi -t "${totalDuration}" -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex "[0:v]ass="${tempAssLink}"[v];[v]${createPaddingFilter(screenSize)}[v];[2:a][1:a]concat=n=2:v=0:a=1[aout];[0:a][aout] amix=inputs=2:duration=first[aout];[aout]afade=type=out:duration=${audioFadeOutDuration}:start_time=${totalDuration - audioFadeOutDuration}[afinal]" -c:v libx264 -c:a libopus -b:a 128k -map [v] -map "[afinal]" -y "${finalVideoPath}"`
    );
  } else {
    await exec(
      `ffmpeg -i "${tempVideoPath}" -filter_complex "[0:v]ass='${tempAssLink}'[v];[v]${createPaddingFilter(screenSize)}[v];[0:a]afade=type=out:duration=${audioFadeOutDuration}:start_time=${totalDuration - audioFadeOutDuration}[afinal]" -c:v libx264 -c:a libopus -b:a 128k -map [v] -map "[afinal]" -y "${finalVideoPath}"`
    );
  }


  // Update story with video info
  const storyJsonPath = path.resolve(storyFolder, "story.json");
  story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));
  story.videoFilePath = finalVideoPath;
  story.hasVideo = true;

  fs.writeFileSync(storyJsonPath, JSON.stringify(story, null, 4));
  fs.unlinkSync(tempAssLink);

  console.log("Cover-only video rendering completed");
  return finalVideoPath;
}

if (require.main === module && process.argv[2]) {
  renderVideo(process.argv[2]);
}

exports.renderVideo = renderVideo;
exports.createVideoClipConfigs = createVideoClipConfigs;
