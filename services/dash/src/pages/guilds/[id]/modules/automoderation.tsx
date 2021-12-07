import dynamic from 'next/dynamic';
import { Box, Heading } from '@chakra-ui/react';
import LoginProtectedPage from '~/HOCs/LoginProtectedPage';
import GuildLayout from '~/components/GuildLayout';
import { useQueryMe } from '~/hooks/useQueryMe';
import { useRouter } from 'next/router';

const AutoModerationSettings = dynamic(() => import('~/components/AutoModerationSettings'));
const NSFWDetectionSettings = dynamic(() => import('~/components/NSFWDetectionSettings'));
const SpamDetectionSettings = dynamic(() => import('~/components/SpamDetectionSettings'));
const MentionSpamDetectionSettings = dynamic(() => import('~/components/MentionSpamDetectionSettings'));
const InviteAutomoderator = dynamic(() => import('~/components/InviteAutomoderator'));

const AutoModerationModulePage = () => {
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
                <Heading mt = {4}
                  mb = {8}
                  size = "md">
                  Auto Moderation Settings
                </Heading>
                <AutoModerationSettings />

                <Heading mt = {4}
                  mb = {8}
                  size = "md">
                  NSFW Detection Settings
                </Heading>
                <NSFWDetectionSettings />

                <Heading mt = {4}
                  mb = {8}
                  size = "md">
                  Spam Detection Settings
                </Heading>
                <SpamDetectionSettings />

                <Heading mt = {4}
                  mb = {8}
                  size = "md">
                  Mention Spam Detection Settings
                </Heading>
                <MentionSpamDetectionSettings />
              </>
            )
            : (<InviteAutomoderator />)
        }
      </Box>
    </GuildLayout>
  );
};

export default LoginProtectedPage(AutoModerationModulePage);
