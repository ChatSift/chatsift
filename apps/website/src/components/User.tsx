'use client';

import Skeleton from 'react-loading-skeleton';
import Button from '~/components/Button';
import { useCurrentURL } from '~/hooks/useCurrentURL';
import { URLS } from '~/util/constants';

function LogInButton() {
	const currentURL = useCurrentURL();

	return currentURL ? (
		<Button>
			<a href={URLS(currentURL.origin).API.LOGIN}>Log in</a>
		</Button>
	) : (
		<Skeleton width={50} height={26} />
	);
}

function LoggedInUser() {
	return <></>;
}

export default function Login() {
	return <LogInButton />;
}
