const fs = require("fs");
const path = require("path");
const { getAudioDurationInSeconds } = require("get-audio-duration");
const { createFolderIfNotExist } = require("./utils");

async function renderShortVideo(topic) {
  const { default: editly } = await import("editly");
  const util = require("util");
  const exec = util.promisify(require("child_process").exec);

  const storyFolder = createFolderIfNotExist("short_story", topic);
  const storyVideoFolder = createFolderIfNotExist(storyFolder, "videos");

  const storyJsonPath = path.resolve(storyFolder, "story.json");
  const story = JSON.parse(fs.readFileSync(storyJsonPath, "utf8"));

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
    standard: "./cover/scary_forest.jpg",
    short: "./cover/scary_forest_vertical.jpg",
  };

  const titleFont = titleFonts[story.genre]
    ? titleFonts[story.genre]
    : titleFonts["default"];
  const titleFontColor = titleFontColors[story.genre]
    ? titleFontColors[story.genre]
    : titleFontColors["default"];
  const lineXStart = 40;
  const fontSize = 40;
  const lineOverLayHeight = 70;
  const lineOverLayLayerPadding = 20;
  const clipGappingTime = 0.5;
  const lineYStart = lineYStartMappings[story.videoType];
  const size = sizeMapping[story.videoType];
  const lineLength = lineLengthMappings[story.videoType];
  const coverImage = coverImages[story.videoType];
  const bgm = genreBGM[story.genre]
    ? genreBGM[story.genre]
    : genreBGM["default"];

  if (!size || !bgm || !lineLength || !lineYStart || !titleFont) {
    return "Please fix videoType and genre";
  }
  const stroyTitleVideoChunkFile = path.resolve(storyVideoFolder, `title.mp4`);

  const stroyVideoChunkFiles = [stroyTitleVideoChunkFile];

  // Generate video for title screen
  const titleConfig = {
    width: size.width,
    height: size.height,
    fps: 30,
    outPath: stroyTitleVideoChunkFile,
    keepSourceAudio: true,
    defaults: {
      transition: null,
    },
    clips: [],
    audioNorm: { enable: true, gaussSize: 3, maxGain: 100 },
    clipsAudioVolume: 1,
    audioTracks: [],
  };
  const titleDuration = await getAudioDurationInSeconds(story.titleAudio);
  const titleClip = {
    duration: titleDuration + 2,
    layers: [
      // The start time for story title audio is at 1 sec
      {
        type: "detached-audio",
        path: story.titleAudio,
        start: 1,
      },
      // Add video cover image and make the title bloody
      {
        type: "image",
        path: story.coverImageFile || coverImage,
        resizeMode: "cover",
      },
      {
        type: "title",
        text: story.title,
        fontPath: titleFont,
        textColor: titleFontColor,
        position: 'top-left'
      },
    ],
  };
  titleConfig.clips.push(titleClip);

  await editly(titleConfig);


  const chunkSize = 100;
  const storyChunks = [];
  for (let i = 0; i < story.contentChunks.length; i += chunkSize) {
    storyChunks.push(story.contentChunks.slice(i, i + chunkSize));
  }

  for (let currentChunk = 0; currentChunk < storyChunks.length; currentChunk += 1) {
    const storyChunk = storyChunks[currentChunk];
    const stroyVideoChunkFile = path.resolve(storyVideoFolder, `story${currentChunk}.mp4`);

    stroyVideoChunkFiles.push(stroyVideoChunkFile);

    if (fs.existsSync(stroyVideoChunkFile)) {
      continue;
    }
    const config = {
      width: size.width,
      height: size.height,
      fps: 30,
      outPath: stroyVideoChunkFile,
      keepSourceAudio: true,
      defaults: {
        transition: null,
      },
      clips: [],
      audioNorm: { enable: true, gaussSize: 3, maxGain: 100 },
      clipsAudioVolume: 1,
      audioTracks: [],
    };

    for (
      let chunkIndex = 0;
      chunkIndex < storyChunk.length;
      chunkIndex++
    ) {
      const contentChunk = storyChunk[chunkIndex];
      // get the end time of the current clip based on the end of the last segement of the chunk
      // add one second to avoid unnatural broken sentence between chuncks
      const lastSegment = contentChunk.transcript.slice(-1)[0];

      // mix the audio for the chunk
      const contentClip = {
        duration: lastSegment.end + 1,
        layers: [
          {
            type: "detached-audio",
            path: contentChunk.audioFile,
            start: clipGappingTime,
          },
        ],
      };
      // render segment images in temporal sequence
      contentClip.layers.push(
        ...contentChunk.transcript.map(({ sceneImageFile, start }) => ({
          type: "image",
          path: sceneImageFile,
          start: start,
        }))
      );

      // render subtitle rectangle
      contentClip.layers.push({
        type: "canvas",
        start: 0,
        func: async ({ canvas }) => {
          async function onRender(progress) {
            const context = canvas.getContext("2d");
            const lineCenterY = (lineYStart + lineYStart - fontSize) / 2 + 10;
            const lineOverLayY = lineCenterY - lineOverLayHeight / 2;
            const lineOverLayX = lineXStart - lineOverLayLayerPadding;

            context.fillStyle = "rgba(0, 0, 0, 0.3)";
            context.fillRect(
              lineOverLayX,
              lineOverLayY,
              size.width - 2 * lineOverLayX,
              lineOverLayHeight
            );
          }
          function onClose() {
            // Cleanup if you initialized anything
          }
          return { onRender, onClose };
        },
      });

      // render subtitle with each current word highlighted
      const allWordSegments = contentChunk.transcript
        .map((segment) => segment.words)
        .flatMap((wordSegments) => wordSegments);

      let currentLineStartIndex = 0;
      let currentLineEndIndex = currentLineStartIndex;

      contentClip.layers.push(
        ...allWordSegments.map((wordSegment, wordSegmentIndex) => {
          const func = async ({ canvas }) => {
            async function onRender(progress) {
              const context = canvas.getContext("2d");
              context.font = `${fontSize}px Verdana`;

              let currentX = lineXStart;
              if (wordSegmentIndex > currentLineEndIndex - 1) {
                currentLineStartIndex = currentLineEndIndex = wordSegmentIndex;
              }

              if (currentLineStartIndex === currentLineEndIndex) {
                while (currentLineEndIndex < allWordSegments.length) {
                  const currentLine = allWordSegments
                    .slice(currentLineStartIndex, currentLineEndIndex + 1)
                    .map((segment) => segment.word)
                    .join("");
                  if (
                    currentX + context.measureText(currentLine).width <
                    size.width - 100
                  ) {
                    currentLineEndIndex++;
                  } else {
                    break;
                  }
                }
              }

              const currentLine = allWordSegments
                .slice(currentLineStartIndex, currentLineEndIndex)
                .map((segment) => segment.word)
                .join("");
              context.fillStyle = "white";
              context.fillText(currentLine, currentX, lineYStart);

              const previousText = allWordSegments
                .slice(currentLineStartIndex, wordSegmentIndex)
                .map((segment) => segment.word)
                .join("");
              currentX += context.measureText(previousText).width;
              context.fillStyle = "yellow";
              context.fillText(wordSegment.word, currentX, lineYStart);
            }

            function onClose() {
              // Cleanup if you initialized anything
            }
            return { onRender, onClose };
          };
          const nextWordSegment = allWordSegments[wordSegmentIndex + 1];
          return {
            type: "canvas",
            func,
            start: wordSegment.start + clipGappingTime,
            stop: nextWordSegment?.start
              ? nextWordSegment?.start + clipGappingTime
              : undefined,
          };
        })
      );
      // filter zero duration layers
      contentClip.layers = contentClip.layers.filter(
        (layer) => layer.start != layer.stop || !layer.start || !layer.stop
      );
      config.clips.push(contentClip);
    }

    // extend the end to avoid sudden stop
    config.clips.slice(-1)[0].duration += 0.5;
    //fs.writeFileSync("./config.json", JSON.stringify(config));
    await editly(config);
  }
  const tempStroyVideoFile = path.resolve(storyVideoFolder, `temp_story.mp4`);
  const textFile = path.resolve(storyVideoFolder, `list.txt`);
  const stroyVideoFile = path.resolve(storyVideoFolder, `story.mp4`);

  //concatenate mp4
  await exec(`(${stroyVideoChunkFiles.map(stroyVideoChunkFile => `echo file '${stroyVideoChunkFile}'`).join(" & ")} )> "${textFile}"`);
  await exec(`ffmpeg -safe 0 -f concat -i "${textFile}" -c copy -y "${tempStroyVideoFile}"`);

  //mix with bgm
  await exec(`ffmpeg -i "${tempStroyVideoFile}" -stream_loop -1 -i "${bgm}" -filter_complex "[0:a][1:a] amix=inputs=2:duration=shortest [audio_out]" -c:v copy -map 0:v -map [audio_out] -y "${stroyVideoFile}"`);

  // delete temp files
  fs.unlinkSync(textFile);
  fs.unlinkSync(tempStroyVideoFile);
  // stroyVideoChunkFiles.forEach(stroyVideoChunkFile => {
  //   fs.unlinkSync(stroyVideoChunkFile);
  // });

  story.videoFile = stroyVideoFile;
  fs.writeFileSync(storyJsonPath, JSON.stringify(story));
}

if (require.main === module && process.argv[2] && process.argv[2].length > 10) {
  renderShortVideo(process.argv[2]);
}

exports.renderShortVideo = renderShortVideo;
