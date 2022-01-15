import dynamic from 'next/dynamic';
import { Grid, Heading } from '@chakra-ui/react';
import type { Snowflake } from 'discord-api-types/v8';

const GuildIcon = dynamic(() => import('~/components/GuildIcon'));

const GuildDisplay = ({ guild }: { guild?: { id: Snowflake; name: string; icon: string | null } }) =>
	guild ? (
		<Grid
			templateColumns={{ base: 'auto', md: '300px' }}
			gap={{ base: '16px' }}
			justifyItems="center"
			justifyContent="center"
			alignItems="center"
			textAlign="center"
			mt={4}
			mb={8}
		>
			<GuildIcon guild={guild} />
			<Heading fontSize="2xl" maxWidth="20ch" isTruncated>
				{guild.name}
			</Heading>
		</Grid>
	) : null;

export default GuildDisplay;
