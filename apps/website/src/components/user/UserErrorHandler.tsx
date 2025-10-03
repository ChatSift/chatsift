import { LoginButton } from './LoginButton';
import { APIError } from '@/utils/fetcher';

// TODO?
export function UserErrorHandler({ error }: { readonly error: Error }) {
	if (error instanceof APIError && error.payload.statusCode === 401) {
		return <LoginButton />;
	}

	console.error(error);
	return <>Error</>;
}
