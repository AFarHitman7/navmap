import * as Keychain from 'react-native-keychain';
import RNFS from 'react-native-fs';
import type { TokenStore } from './api';
import type { PackAdapter } from './pack';

/** OS secure storage for the admin session token (survey only). */
export function keychainTokenStore(service = 'navmap-admin'): TokenStore {
  return {
    getToken: async () => {
      const creds = await Keychain.getGenericPassword({ service });
      return typeof creds === 'object' && creds ? creds.password : null;
    },
    setToken: async (token: string) => {
      await Keychain.setGenericPassword('admin', token, { service });
    },
    clear: async () => {
      await Keychain.resetGenericPassword({ service });
    },
  };
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i > 0 ? path.slice(0, i) : '';
}

/** react-native-fs adapter: write the V3 manifest, rename, then activate it. */
export function fsPackAdapter(baseDir = `${RNFS.DocumentDirectoryPath}`): PackAdapter {
  const abs = (p: string) => `${baseDir}/${p}`;
  const ensureParent = async (dest: string) => {
    const parent = parentDir(abs(dest));
    if (parent) await RNFS.mkdir(parent).catch(() => undefined);
  };
  return {
    getJson: async (url: string) => (await fetch(url)).json(),
    rename: async (from: string, to: string) => RNFS.moveFile(abs(from), abs(to)),
    writeFile: async (path: string, data: string) => {
      await ensureParent(path);
      return RNFS.writeFile(abs(path), data, 'utf8');
    },
    readFile: async (path: string) => RNFS.readFile(abs(path), 'utf8'),
    rmrf: async (path: string) => RNFS.unlink(abs(path)).catch(() => undefined),
  };
}
