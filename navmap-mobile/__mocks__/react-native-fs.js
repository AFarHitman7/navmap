// Manual mock: in-memory react-native-fs for jest (node env).
const files = new Map();

const RNFS = {
  DocumentDirectoryPath: '/mock-documents',
  mkdir: async () => undefined,
  downloadFile: ({ toFile }) => ({
    promise: Promise.resolve({ statusCode: 200, bytesWritten: 0 }).then((r) => {
      files.set(toFile, files.get(toFile) ?? '');
      return r;
    }),
  }),
  hash: async (path) => Buffer.from(`hash-of:${path}`).toString('base64'),
  stat: async (path) => ({ size: (files.get(path) ?? '').length }),
  moveFile: async () => undefined,
  writeFile: async (path, data) => {
    files.set(path, data);
  },
  readFile: async (path) => {
    const v = files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  },
  unlink: async (path) => {
    files.delete(path);
  },
  __files: files,
};

module.exports = RNFS;
module.exports.default = RNFS;
