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

// Transition effects organized by mood/style
const transitionEffects = {
  // Soft, smooth transitions for calm/emotional scenes
  soft: [
    "fade",
    "fadeblack",
    "fadewhite",
    "dissolve",
    "pixelize",
    "smoothleft",
    "smoothright",
    "smoothup",
    "smoothdown",
  ],

  // Dynamic, energetic transitions for action/exciting scenes
  dynamic: [
    "wipeleft",
    "wiperight",
    "wipeup",
    "wipedown",
    "slideleft",
    "slideright",
    "slideup",
    "slidedown",
    "squeezev",
    "squeezeh",
    "zoomin",
  ],

  // Geometric/creative transitions for stylized content
  geometric: [
    "circlecrop",
    "rectcrop",
    "circleopen",
    "circleclose",
    "diagtl",
    "diagtr",
    "diagbl",
    "diagbr",
    "hlslice",
    "hrslice",
    "vuslice",
    "vdslice",
  ],

  // Blur/distortion effects for dramatic scenes
  dramatic: [
    "hblur",
    "radial",
    "distance",
    "fadefast",
    "fadeslow",
    "wipetl",
    "wipetr",
    "wipebl",
    "wipebr",
  ],

  // Horror-specific eerie transitions
  horror: [
    "fadeblack",
    "fadefast",
    "distance",
    "radial",
    "hblur",
    "circleclose",
    "diagtl",
    "diagbr",
  ],

  // Kid-friendly playful transitions
  kid: [
    "fade",
    "dissolve",
    "circleopen",
    "circlecrop",
    "zoomin",
    "slideleft",
    "slideright",
    "pixelize",
  ],
};

// Genre-specific transition settings
const genreTransitionSettings = {
  horror: {
    effects: transitionEffects.horror,
    duration: 0.6, // Slightly longer for suspense
  },
  horror_female_vocal: {
    effects: transitionEffects.horror,
    duration: 0.6,
  },
  mythology: {
    effects: [...transitionEffects.soft, ...transitionEffects.geometric],
    duration: 0.7, // Smoother, more epic feel
  },
  kid: {
    effects: transitionEffects.kid,
    duration: 0.4, // Snappier for kids
  },
  default: {
    effects: [...transitionEffects.soft, ...transitionEffects.dynamic],
    duration: 0.5,
  },
};

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
  transitionEffects,
  genreTransitionSettings,
  numGPUs,
  subtitleYs,
  screenSizeMapping,
};
