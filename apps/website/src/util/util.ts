import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const retryWrapper = (retry: (retries: number, error: Error) => boolean) => {
	return (retries: number, error: Error) => {
		if (process.env.NODE_ENV === 'development') {
			return false;
		}

		return retry(retries, error);
	};
};

export const exponentialBackOff = (failureCount: number) => 2 ** failureCount * 1_000;
