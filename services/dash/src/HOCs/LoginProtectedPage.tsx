
/* eslint-disable react/display-name, react-hooks/rules-of-hooks */

import useLoginProtectedPage from '~/hooks/useLoginProtecedPage';
import { Center, Spinner } from '@chakra-ui/react';
import Layout from '~/components/Layout';

const LoginProtectedPage = (Component: React.FC) => (props: any) => {
  const loggedIn = useLoginProtectedPage();

  if (loggedIn) {
    return (<Component {...props} />);
  }

  // TODO(DD): Properly center spinner
  return (
    <Layout>
      <Center>
        <Spinner size = "xl" />
      </Center>
    </Layout>
  );
};

export default LoginProtectedPage;
