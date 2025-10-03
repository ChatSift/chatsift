'use client';

import { useRouter } from 'next/navigation';
import { Button } from '../common/Button';
import { client } from '@/data/client';

interface LogoutButtonProps {
	// eslint-disable-next-line @typescript-eslint/method-signature-style
	readonly additionally?: () => void;
	readonly className?: string;
}

export function LogoutButton({ className, additionally }: LogoutButtonProps) {
	const logoutMutation = client.auth.useLogout();
	const router = useRouter();

	return (
		<Button
			className={className ?? ''}
			onClick={async () => {
				await logoutMutation.mutateAsync(undefined as never);
				router.replace('/');
				additionally?.();
			}}
			type="button"
		>
			<span className="text-primary dark:text-primary-dark">Log out</span>
		</Button>
	);
}
