import Head from 'next/head';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { Box, Heading, Button, Grid, Link, Center } from '@chakra-ui/react';
import { FiCornerUpLeft } from 'react-icons/fi';
import { useUserStore } from '~/store/index';
import { useQueryMe } from '~/hooks/useQueryMe';

const GuildNavbar = dynamic(() => import('~/components/GuildNavbar'));
const GuildDisplay = dynamic(() => import('~/components/GuildDisplay'));

const GuildLayout = ({ children }: { children: React.ReactNode }) => {
	useQueryMe();

	const user = useUserStore();
	const router = useRouter();
	const { id } = router.query as { id: string };

	const guild = user.guilds?.find((g) => g.id === id);

	return (
		<>
			<Head>
				<title>{guild?.name ?? 'Unknown guild'} | AutoModerator Dashboard</title>
			</Head>
			<Grid
				templateColumns={{ base: 'auto', lg: '300px auto' }}
				templateRows={{ base: 'auto', lg: 'unset' }}
				h="100%"
				w="100%"
			>
				<Box>
					<Box mt={4} px={{ base: 50, lg: 6 }}>
						<Link href="/guilds">
							<Button variant="link" leftIcon={<FiCornerUpLeft />}>
								Go back
							</Button>
						</Link>
					</Box>
					<GuildDisplay guild={guild} />
					{guild ? <GuildNavbar /> : null}
				</Box>
				{guild ? (
					children
				) : (
					<Center>
						<Box my={{ base: 12 }} px={{ base: 50, xl: 150 }} textAlign="center">
							<Heading fontSize="xl" mb={6}>
								{'AutoModerator is not in this guild yet, or you cannot manage its settings'}
							</Heading>
							<Link target="_blank" href={process.env.NEXT_PUBLIC_INVITE_LINK}>
								<Button>Invite AutoModerator</Button>
							</Link>
						</Box>
					</Center>
				)}
			</Grid>
		</>
	);
};

export default GuildLayout;
