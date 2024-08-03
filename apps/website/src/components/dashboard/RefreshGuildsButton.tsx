'use client';

import { useAtom } from 'jotai';
import { useState } from 'react';
import Button from '~/components/common/Button';
import SvgRefresh from '~/components/svg/SvgRefresh';
import { useQueryUserMe } from '~/data/userMe/client';
import { useLoggedInUser } from '~/hooks/useLoggedInUser';
import { useToast } from '~/hooks/useToast';

export default function RefreshGuildsButton() {
	const { refetch } = useLoggedInUser();
	const { toast, dismiss } = useToast();
	const [lastToastId, setLastToastId] = useState<string | null>(null);
	const { isLoading } = useQueryUserMe();

	return (
		<Button
			className="border-2 border-solid border-on-primary px-4 py-2 text-secondary dark:border-on-primary-dark dark:text-secondary-dark"
			isDisabled={isLoading}
			onPress={async () => {
				await refetch();

				if (lastToastId) {
					dismiss(lastToastId);
				}

				const toasted = toast({
					title: 'Guilds refreshed',
					description: 'Your guilds have been successfully refreshed.',
				});

				setLastToastId(toasted.id);
			}}
		>
			<SvgRefresh />
			Refresh
		</Button>
	);
}
