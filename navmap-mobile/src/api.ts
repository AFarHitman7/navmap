import { apiBase } from './pack';

export type TokenStore = {
  getToken: () => Promise<string | null>;
  setToken: (token: string) => Promise<void>;
  clear: () => Promise<void>;
};

/** In-memory token store for tests; app wires react-native-keychain. */
export function memoryTokenStore(): TokenStore & { token: string | null } {
  const s: { token: string | null } = { token: null };
  return {
    token: null,
    getToken: async () => s.token,
    setToken: async (t: string) => {
      s.token = t;
    },
    clear: async () => {
      s.token = null;
    },
  };
}

export type HttpPost = (
  url: string,
  body: unknown,
  token?: string,
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export async function adminLogin(
  password: string,
  httpPost: HttpPost,
  store: TokenStore,
  base: string = apiBase(),
): Promise<string> {
  const res = await httpPost(`${base}/api/admin/login`, { password });
  const data = (await res.json()) as { token?: string };
  if (res.status !== 200 || !data.token) throw new Error('login failed');
  await store.setToken(data.token);
  return data.token;
}

