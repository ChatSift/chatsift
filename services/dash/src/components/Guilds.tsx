import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Center, Grid, GridItem } from '@chakra-ui/react';
import { useUserStore } from '~/store/index';

const Layout = dynamic(() => import('~/components/Layout'));
const Loading = dynamic(() => import('~/components/Loading'));
const GuildIcon = dynamic(() => import('~/components/GuildIcon'));
const GuildText = dynamic(() => import('~/components/GuildText'));

const Guilds = () => {
	const user = useUserStore();

	if (!user.loggedIn) {
		return (
			<Layout>
				<Center h="100%">
					<Loading />
				</Center>
			</Layout>
		);
	}

	return (
		<Grid templateColumns="repeat(auto-fit, 150px)" gap="32px 0px" placeContent="center">
			{user.guilds?.map((guild) => (
				<GridItem key={guild.id}>
					<Link href={`/guilds/${guild.id}`}>
						<Grid gap="8px 0px" placeItems="center">
							<GuildIcon guild={guild} />
							<GuildText name={guild.name} />
						</Grid>
					</Link>
				</GridItem>
			))}
		</Grid>
	);
};

export default Guilds;
