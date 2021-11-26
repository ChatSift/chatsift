// import dynamic from 'next/dynamic';
import { Box, Heading } from '@chakra-ui/react';
import LoginProtectedPage from '~/HOCs/LoginProtectedPage';
import GuildLayout from '~/components/GuildLayout';

// const GuildSettings = dynamic(() => import('~/components/GuildSettings'));
// const GuildModules = dynamic(() => import('~/components/GuildModules'));

const GuildPage = () => (
  <GuildLayout>
    <Box my = {{ base: 12 }} px = {{ base: 50, xl: 150 }}>
      <Heading mb = {8} size = "md">
        Guild Settings
      </Heading>
      {/* <GuildSettings /> */}
      <Heading my = {8} size = "md">
        Guild Modules
      </Heading>
      {/* <GuildModules /> */}
    </Box>
  </GuildLayout>
);

export default LoginProtectedPage(GuildPage);
