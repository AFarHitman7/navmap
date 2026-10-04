// Manual mock: in-memory react-native-keychain for jest (node env).
let password = null;

module.exports = {
  getGenericPassword: async () =>
    password === null ? false : { username: 'admin', password, service: 'mock' },
  setGenericPassword: async (_user, pw) => {
    password = pw;
    return true;
  },
  resetGenericPassword: async () => {
    password = null;
    return true;
  },
  __reset: () => {
    password = null;
  },
};
