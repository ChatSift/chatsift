'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Button } from '@/components/common/Button';
import { URLS } from '@/utils/urls';

export function LoginButton() {
	const pathname = usePathname();
	const search = useSearchParams().toString();

	return (
		<Button type="button">
			<a href={URLS.API.login(search ? `${pathname}?${search}` : pathname)}>Log in</a>
		</Button>
	);
}
