'use client';

import type { BotId } from '@chatsift/core';
import { useParams } from 'next/navigation';
import { useRefreshGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { SvgRefresh } from '@/components/icons/SvgRefresh';

interface RefreshServerDataButtonProps {
	readonly for_bot: BotId;
}

export function RefreshServerDataButton({ for_bot }: RefreshServerDataButtonProps) {
	const params = useParams<{ id: string }>();
	const { id: guildId } = params;

	const { mutateAsync: refreshGuildInfo, isPending } = useRefreshGuildInfo(guildId, for_bot);

	return (
		<Button
			className="border border-solid border-on-primary px-4 py-2 text-secondary dark:border-on-primary-dark dark:text-secondary-dark"
			isDisabled={isPending}
			onPress={async () => {
				await refreshGuildInfo();
			}}
		>
			<SvgRefresh />
			Refresh Server Data
		</Button>
	);
}
