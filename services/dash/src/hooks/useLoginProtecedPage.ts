import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useUserStore } from '~/store/index';
import { useQueryMe } from '~/hooks/useQueryMe';

const useLoginProtectedRoute = () => {
  const { data } = useQueryMe();

  const user = useUserStore();
  const router = useRouter();

  useEffect(() => {
    if (data === null) {
      void router.replace('/').catch(() => null);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  return user.loggedIn;
};

export default useLoginProtectedRoute;
