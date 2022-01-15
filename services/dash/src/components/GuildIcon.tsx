import dynamic from 'next/dynamic';
import { Img } from '@chakra-ui/react';
import type { Snowflake } from 'discord-api-types/v8';

const MotionBox = dynamic(() => import('~/components/MotionBox'));

const GuildIcon = ({ guild }: { guild?: { id: Snowflake; name: string; icon: string | null } }) =>
	guild ? (
		<MotionBox
			whileHover={{ scale: 1.05, rotate: 5 }}
			whileTap={{ scale: 0.95 }}
			transition={{ type: 'spring', stiffness: 200 }}
		>
			<Img
				rounded="full"
				boxSize="100px"
				src={
					guild.icon
						? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}${
								guild.icon.startsWith('a_') ? '.gif' : '.png'
						  }`
						: `https://cdn.discordapp.com/embed/avatars/${
								guild.id.split('').reduce((a, b) => a + parseInt(b, 10), 0) % 5
						  }.png`
				}
			/>
		</MotionBox>
	) : null;

export default GuildIcon;
