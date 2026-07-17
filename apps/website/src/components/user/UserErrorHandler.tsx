import { LoginButton } from './LoginButton';
import { APIError } from '@/api/error';

// TODO?
export function UserErrorHandler({ error }: { readonly error: Error }) {
	if (error instanceof APIError && error.statusCode === 401) {
		return <LoginButton />;
	}

	console.error(error);
	return <>Error</>;
}
