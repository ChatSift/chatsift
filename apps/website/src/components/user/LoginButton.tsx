'use client';

import { usePathname } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { URLS } from '@/utils/urls';

export function LoginButton() {
	const pathname = usePathname();

	return (
		<Button type="button">
			<a href={URLS.API.login(pathname)}>Log in</a>
		</Button>
	);
}
