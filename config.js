const sizeMapping = {
  standard: { width: 1024, height: 1024 },
  short: { width: 1024, height: 1024 },
};

const screenSizeMapping = {
  standard: { width: 1024, height: 768 },
  short: { width: 768, height: 1360 },
};

const lineLengthMappings = {
  standard: 6,
  short: 4,
};

const subtitleYs = {
  standard: 40,
  short: 250,
};
const genreBGM = {
  horror_female_vocal: "./resources/BGMs/horror_lady_vocal.mp3",
  horror: "./resources/BGMs/dead_silence.mp3",
  default: "./resources/BGMs/Sunset-Landscape.mp3",
  kid: "./resources/BGMs/Sunset-Landscape.mp3",
  mythology: "./resources/BGMs/intriguing.mp3",
};

const titleFonts = {
  horror: "./resources/BGMs/Comfortaa_Bold.ttf",
  default: "./resources/BGMs/Comfortaa_Bold.ttf",
  kid: "./resources/BGMs/Comfortaa_Bold.ttf",
  mythology: "./resources/BGMs/Comfortaa_Bold.ttf",
};

const titleFontColors = {
  horror: "#FF0000",
  default: "#FFFF00",
  kid: "#FFFF00",
  mythology: "#FFFFFF",
};

const coverImages = {
  standard: "./cover/scary_forest.png",
  short: "./cover/scary_forest_vertical.png",
};

const subtitleFontSizes = {
  standard: 40,
  short: 60,
};

const titleFontSizes = {
  standard: 50,
  short: 50,
};

const clipGappingTime = 0.3;
const framerate = 30;
const transitionDuration = 0.5;
const audioFadeOutDuration = 1;

const numGPUs = 2;
module.exports = {
  sizeMapping,
  lineLengthMappings,
  genreBGM,
  titleFonts,
  titleFontColors,
  coverImages,
  subtitleFontSizes,
  titleFontSizes,
  clipGappingTime,
  framerate,
  audioFadeOutDuration,
  transitionDuration,
  numGPUs,
  subtitleYs,
  screenSizeMapping,
};
