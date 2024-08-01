'use client';

import Button from '~/components/Button';
import { useCurrentURL } from '~/hooks/useCurrentURL';
import { URLS } from '~/util/constants';

function LogInButton() {
	const currentURL = useCurrentURL();

	return (
		<Button>
			<a href={currentURL ? URLS(currentURL.origin).API.LOGIN : ''}>Log in</a>
		</Button>
	);
}

function LoggedInUser() {
	return <></>;
}

export default function Login() {
	return <LogInButton />;
}
