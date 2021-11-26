import LoginProtectedPage from '~/HOCs/LoginProtectedPage';
import Layout from '~/components/Layout';
import { Grid, Box, Img, Heading, Center } from '@chakra-ui/react';
import { useUserStore } from '~/store/index';
import dynamic from 'next/dynamic';

const Guilds = dynamic(() => import('~/components/Guilds'));

const GuildsPage = () => {
  const user = useUserStore();

  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator!, 10) % 5}.png`;

  const UserDisplay = () =>
    user.loggedIn
      ? (
        <>
          <Img rounded = "full" boxSize = "100px"
            src = {avatar} alt = {user.username!} />

          <Heading>
            {user.username}
          </Heading>
        </>
      )
      : null;

  return (
    <Layout>
      <Grid templateColumns = {{ base: 'auto', md: '150px' }}
        gap = {{ base: '32px', md: '8px' }}
        autoFlow = "column"
        justifyItems = "center"
        justifyContent = "center"
        alignItems = "center"
        my = {{ base: 12 }}
        px = {{ base: 0, md: 200 }}
      >
        <UserDisplay />
      </Grid>

      <Box mt = {{ base: 12, lg: 24 }} mb = {{ base: 12 }}
        px = {{ base: 0, md: 200 }}>
        <Box px = {8} pb = {8}>
          <Center>
            <Heading size = "lg">
              Manage your guilds
            </Heading>
          </Center>
        </Box>
        <Guilds />
      </Box>
    </Layout>
  );
};

export default LoginProtectedPage(GuildsPage);
