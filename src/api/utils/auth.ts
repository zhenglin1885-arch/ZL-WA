import { when } from 'mobx';
import localStorage from 'mobx-localstorage';
import { ferdiumLocale, ferdiumVersion } from '../../environment-remote';
import apiBase, { localServerToken, needsToken } from '../apiBase';

export const prepareAuthRequest = (
  // eslint-disable-next-line unicorn/no-object-as-default-parameter
  options = { method: 'GET' },
  auth = true,
) => {
  const request = Object.assign(options, {
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json',
      'X-Franz-Source': 'desktop',
      'X-Franz-Version': ferdiumVersion,
      'X-Franz-platform': process.platform,
      'X-Franz-Timezone-Offset': new Date().getTimezoneOffset(),
      'X-Franz-System-Locale': ferdiumLocale,
      // @ts-expect-error Property 'headers' does not exist on type '{ method: string; }'.
      ...options.headers,
    },
  });

  if (auth) {
    request.headers.Authorization = `Bearer ${localStorage.getItem(
      'authToken',
    )}`;
  }

  return request;
};

export const prepareLocalToken = async (requestData: {
  method: string;
  headers?: any;
  body?: any;
}) => {
  await when(() => !needsToken() || !!localServerToken(), { timeout: 2000 });
  const token = localServerToken();
  if (token) {
    // eslint-disable-next-line no-param-reassign
    requestData.headers['X-Ferdium-Local-Token'] = token;
  }
};

export const sendAuthRequest = async (
  url: RequestInfo,
  options?: { method: string; headers?: any; body?: any },
  auth?: boolean,
) => {
  // Account/service/workspace requests may only reach this process's local API.
  const target = new URL(typeof url === 'string' ? url : url.toString());
  if (target.origin !== apiBase(false))
    throw new Error('本地模式禁止连接远程账户服务器');
  const request = prepareAuthRequest(options, auth);
  await prepareLocalToken(request);
  // @ts-expect-error Argument of type '{ method: string; } & { mode: string; headers: any; }' is not assignable to parameter of type 'RequestInit | undefined'.
  return window.fetch(url, request);
};
