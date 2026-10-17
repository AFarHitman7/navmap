const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('node:path');

/** Metro bundler config for the bare RN app (index.js entry). */
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [path.resolve(__dirname, '../shared')],
});
