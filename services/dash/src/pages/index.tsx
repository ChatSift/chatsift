import { Box, Heading } from '@chakra-ui/react';
import Layout from '~/components/Layout';

const Home = () => (
  <Layout>
    <Box my = {{ base: 12 }}>
      <Heading size = "lg" textAlign = "center">
        Welcome to the AutoModerator dashboard
      </Heading>
    </Box>
  </Layout>
);

export default Home;