const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/** Metro bundler config for the bare RN app (index.js entry). */
module.exports = mergeConfig(getDefaultConfig(__dirname), {});
