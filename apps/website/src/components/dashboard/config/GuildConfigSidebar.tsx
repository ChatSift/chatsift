'use client';

import type { BotId } from '@chatsift/shared';
import { useRouter } from 'next/navigation';
import Sidebar from '~/components/common/Sidebar';
import { client } from '~/data/client';

interface Props {
	readonly currentBot?: BotId;
}

export default function GuildConfigSidebar({ currentBot }: Props) {
	const router = useRouter();
	const { data: bots } = client.useBots();

	return <Sidebar className="gap-4">:3</Sidebar>;
}
