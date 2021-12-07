import dynamic from 'next/dynamic';
import { Box, Heading } from '@chakra-ui/react';
import LoginProtectedPage from '~/HOCs/LoginProtectedPage';
import GuildLayout from '~/components/GuildLayout';
import { useRouter } from 'next/router';
import { useQueryMe } from '~/hooks/useQueryMe';

const LoggingSettings = dynamic(() => import('~/components/LoggingSettings'));
const InviteAutomoderator = dynamic(() => import('~/components/InviteAutomoderator'));

const LoggingModulePage = () => {
  const router = useRouter();
  const { user } = useQueryMe();

  const { id } = router.query as { id: string };
  const guild = user?.guilds.find(g => g.id === id);

  return (
    <GuildLayout>
      <Box my = {{ base: 12 }} px = {{ base: 50, xl: 150 }}>
        {
          guild?.data
            ? (
              <>
                <Heading mb = {8} size = "md">
                  Auto Moderation Settings
                </Heading>
                <LoggingSettings />
              </>
            )
            : (<InviteAutomoderator />)
        }
      </Box>
    </GuildLayout>
  );
};

export default LoginProtectedPage(LoggingModulePage);
