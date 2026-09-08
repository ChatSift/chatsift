'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { usePathname, useSearchParams } from 'next/navigation';
import { URLS } from '@/utils/urls';

interface LoginButtonProps {
	readonly label?: string;
}

export function LoginButton({ label = 'Log in' }: LoginButtonProps = {}) {
	const pathname = usePathname();
	const search = useSearchParams().toString();

	return (
		<Button type="button">
			<a href={URLS.API.login(search ? `${pathname}?${search}` : pathname)}>{label}</a>
		</Button>
	);
}
