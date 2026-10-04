// Manual mock: react-native-geolocation-service for jest (node env).
const Geolocation = {
  getCurrentPosition: (_success, error) => {
    if (typeof error === 'function') error(new Error('mock: no gps'));
  },
  watchPosition: () => 0,
  clearWatch: () => undefined,
  requestAuthorization: async () => 'granted',
};

module.exports = Geolocation;
module.exports.default = Geolocation;
