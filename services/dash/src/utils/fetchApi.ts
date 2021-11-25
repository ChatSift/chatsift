import type { useToast } from '@chakra-ui/react';

export interface FetchApiOptions<B = any>{
  path: string;
  method?: string;
  body?: B;
  toast?: ReturnType<typeof useToast>;
}

const HEADERS = [
  ['Content-Type', 'application/json']
];

// TODO(DD): Error handling
const refreshToken = async (retries = 0): Promise<null | void> => {
  const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_DOMAIN}/api/v1/auth/discord/refresh`, {
    headers: HEADERS,
    method: 'GET'
  });

  if (response.status === 401) {
    return null;
  } else if (response.status >= 500 && response.status < 600) {
    await new Promise(res => setTimeout(res, 1500));
    return refreshToken(retries + 1);
  } else if (!response.ok) {
    // TODO(DD): Handle other errors - i.e. toast
    return null;
  }
};

export const fetchApi = async <T, B = any>(options: FetchApiOptions<B>): Promise<T> => {
  const { path, method = 'GET', body } = options;

  const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_DOMAIN}/api/v1${path}`, {
    headers: HEADERS,
    method,
    body: JSON.stringify(body)
  });

  if (response.status === 401) {
    if (await refreshToken() === null) {
      return null as unknown as T;
    }

    return fetchApi(options);
  } else if (response.status >= 500 && response.status < 600) {
    await new Promise(res => setTimeout(res, 1500));
    return fetchApi(options);
  } else if (!response.ok) {
    // TODO(DD): Handle other errors - i.e. toast
    return null as unknown as T;
  }

  // TODO(DD): Handle json parsing errors
  const json = await response.json().catch(() => null);
  return json;
};
