
/* eslint-disable react/display-name, react-hooks/rules-of-hooks */

import useLoginProtectedPage from '~/hooks/useLoginProtecedPage';
import { Center } from '@chakra-ui/react';
import Layout from '~/components/Layout';
import dynamic from 'next/dynamic';

const Loading = dynamic(() => import('../components/Loading'));

const LoginProtectedPage = (Component: React.FC) => (props: any) => {
  const loggedIn = useLoginProtectedPage();

  if (!loggedIn) {
    return (
      <Layout>
        <Center h = "100%">
          <Loading />
        </Center>
      </Layout>
    );
  }

  return (<Component {...props} />);
};

export default LoginProtectedPage;
