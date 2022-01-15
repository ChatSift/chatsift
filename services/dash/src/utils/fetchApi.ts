import type { useToast } from '@chakra-ui/react';

export interface FetchApiOptions<B = any> {
	path: string;
	method?: string;
	body?: B;
	toast?: ReturnType<typeof useToast>;
	retries?: number;
}

const HEADERS = [['Content-Type', 'application/json']];

// TODO(DD): Error handling
const refreshToken = async (retries = 0): Promise<null | void> => {
	const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_DOMAIN}/api/v1/auth/discord/refresh`, {
		headers: HEADERS,
		method: 'GET',
		credentials: 'include',
	});

	if (response.status === 401) {
		return null;
	} else if (response.status >= 500 && response.status < 600) {
		await new Promise((res) => setTimeout(res, 1500));

		if (++retries === 3) {
			return null;
		}

		return refreshToken(retries);
	} else if (!response.ok) {
		// TODO(DD): Handle other errors - i.e. toast
		return null;
	}
};

/**
 * Makes an API request using the specified options - also handles error reporting
 *
 * @returns The response body if things went well, null in the event of lack of auth or an unexpected error
 */
export const fetchApi = async <T, B = any>(options: FetchApiOptions<B>): Promise<T | null> => {
	const { path, method = 'GET', body, toast } = options;
	let { retries = 0 } = options;

	const response = await fetch(`${process.env.NEXT_PUBLIC_API_DOMAIN}/api/v1${path}`, {
		headers: HEADERS,
		method,
		credentials: 'include',
		body: JSON.stringify(body),
	});

	if (response.status === 401) {
		if ((await refreshToken()) === null) {
			return null;
		}

		return fetchApi(options);
	} else if (!response.ok) {
		// TODO(DD): Handle other errors - i.e. toast
		const errorData = await response.json().catch(() => null);

		toast?.({
			title: errorData ? `${errorData.statusCode} - ${errorData.error}` : `${response.status} - Unknown Error`,
			description: errorData?.message ?? 'An unknown error occured',
			isClosable: true,
			duration: 3000,
			status: 'error',
		});

		if (response.status >= 500 && response.status < 600) {
			await new Promise((res) => setTimeout(res, 1500));

			if (++retries === 3) {
				return null;
			}

			return fetchApi({ ...options, retries });
		}

		return null;
	}

	// TODO(DD): Handle json parsing errors
	const json = await response.json().catch(() => null);
	return json;
};
