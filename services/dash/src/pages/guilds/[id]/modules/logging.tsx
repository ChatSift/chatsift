import dynamic from 'next/dynamic';
import { Box, Heading } from '@chakra-ui/react';
import LoginProtectedPage from '~/HOCs/LoginProtectedPage';
import GuildLayout from '~/components/GuildLayout';

const LoggingSettings = dynamic(() => import('~/components/LoggingSettings'));

const LoggingModulePage = () => (
  <GuildLayout>
    <Box my = {{ base: 12 }} px = {{ base: 50, xl: 150 }}>
      <Heading mb = {8} size = "md">
        Auto Moderation Settings
      </Heading>
      <LoggingSettings />
    </Box>
  </GuildLayout>
);

export default LoginProtectedPage(LoggingModulePage);
