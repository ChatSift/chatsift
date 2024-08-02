'use client';

import Link from 'next/link';
import Button from '~/components/Button';
import { useUser } from '~/hooks/useUser';
import { URLS } from '~/util/constants';

function LogInButton() {
	return (
		<Button>
			<Link href={URLS.API.LOGIN}>Log in</Link>
		</Button>
	);
}

function LoggedInUser() {
	return <></>;
}

export default function Login() {
	// const { data } = useUser();

	return <LogInButton />;
}
