import type { Snowflake } from 'discord-api-types/v10';
import type { Metadata } from 'next';
import { server } from '~/data/server';

interface Props {
	readonly params: {
		readonly id: Snowflake;
	};
}

export async function generateMetadata({ params: { id } }: Props): Promise<Metadata> {
	const me = await server.me.fetch();
	const guild = me?.guilds.find((guild) => guild.id === id);

	return {
		title: `${guild?.name ?? 'Unknown'}`,
	};
}

export default async function DashboardGuildPage({ params: { id: guildId } }: Props) {
	return <></>;
}
