'use client';

import Link from 'next/link';
import Button from '~/components/Button';
import Skeleton from '~/components/Skeleton';
import { useCurrentURL } from '~/hooks/useCurrentURL';
import { URLS } from '~/util/constants';

function LogInButton() {
	const currentURL = useCurrentURL();

	return currentURL ? (
		<Button>
			<Link href={URLS.API.LOGIN(currentURL.origin)}>Log in</Link>
		</Button>
	) : (
		<Skeleton className="h-8 w-12" />
	);
}

function LoggedInUser() {
	return <></>;
}

export default function Login() {
	return <LogInButton />;
}
