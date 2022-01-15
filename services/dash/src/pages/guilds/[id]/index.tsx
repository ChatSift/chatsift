import dynamic from 'next/dynamic';
import { Box, Heading } from '@chakra-ui/react';
import LoginProtectedPage from '~/HOCs/LoginProtectedPage';
import GuildLayout from '~/components/GuildLayout';
import { useRouter } from 'next/router';
import { useQueryMe } from '~/hooks/useQueryMe';

const GuildSettings = dynamic(() => import('~/components/GuildSettings'));
const InviteAutomoderator = dynamic(() => import('~/components/InviteAutomoderator'));

// TODO(DD): (this applies to all other config pages) - figure out toast notifications to indicate success/failure
const GuildPage = () => {
	const router = useRouter();
	const { user } = useQueryMe();

	const { id } = router.query as { id: string };
	const guild = user?.guilds.find((g) => g.id === id);

	return (
		<GuildLayout>
			<Box my={{ base: 12 }} px={{ base: 50, xl: 150 }}>
				{guild?.data ? (
					<>
						<Heading mb={8} size="md">
							Guild Settings
						</Heading>
						<GuildSettings />
					</>
				) : (
					<InviteAutomoderator />
				)}
			</Box>
		</GuildLayout>
	);
};

export default LoginProtectedPage(GuildPage);
