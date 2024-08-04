import type { Snowflake } from 'discord-api-types/v10';
import type { Metadata } from 'next';
import { fetchUserMe } from '~/data/userMe/server';

interface Props {
	readonly params: {
		readonly id: Snowflake;
	};
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const me = await fetchUserMe();
	const guild = me?.guilds.find((guild) => guild.id === params.id);

	return {
		title: `${guild?.name ?? 'Unknown'}`,
	};
}

export default async function DashboardGuildPage({ params: { id: guildId } }: Props) {
	return <></>;
}
