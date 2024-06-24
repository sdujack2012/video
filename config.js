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

const clipGappingTime = 0.1;
const framerate = 60;
const transitionDuration = 0.5;
const audioFadeOutDuration = 0.5;

const numGPUs = 2;
module.exports = {
  sizeMapping,
  lineLengthMappings,
  lineYStartMappings,
  genreBGM,
  titleFonts,
  titleFontColors,
  coverImages,
  subtitleFontSizes,
  clipGappingTime,
  framerate,
  audioFadeOutDuration,
  transitionDuration,
  numGPUs,
};
