import dynamic from 'next/dynamic';
import { Box, Heading } from '@chakra-ui/react';
import LoginProtectedPage from '~/HOCs/LoginProtectedPage';
import GuildLayout from '~/components/GuildLayout';

const AutoModerationSettings = dynamic(() => import('~/components/AutoModerationSettings'));
const NSFWDetectionSettings = dynamic(() => import('~/components/NSFWDetectionSettings'));
const SpamDetectionSettings = dynamic(() => import('~/components/SpamDetectionSettings'));
const MentionSpamDetectionSettings = dynamic(() => import('~/components/MentionSpamDetectionSettings'));

const AutoModerationModulePage = () => (
  <GuildLayout>
    <Box my = {{ base: 12 }} px = {{ base: 50, xl: 150 }}>
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
    </Box>
  </GuildLayout>
);

export default LoginProtectedPage(AutoModerationModulePage);
