'use client';

import { LoginButton as SharedLoginButton } from '@chatsift/web-core/components/nav/LoginButton';
import { usePathname, useSearchParams } from 'next/navigation';
import { URLS } from '@/utils/urls';

interface LoginButtonProps {
	readonly label?: string;
}

/**
 * The dashboard's half of the shared navbar button: everything visual lives in `@chatsift/web-core`, and what
 * stays here is the one thing that cannot -- which OAuth route this site logs in through, and the path it
 * returns to.
 */
export function LoginButton({ label }: LoginButtonProps = {}) {
	const pathname = usePathname();
	const search = useSearchParams().toString();

	return <SharedLoginButton href={URLS.API.login(search ? `${pathname}?${search}` : pathname)} label={label} />;
}
