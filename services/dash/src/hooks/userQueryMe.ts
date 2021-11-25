import { ApiGetUsersMeResult } from '@automoderator/core';
import { useEffect } from 'react';
import { useQuery } from 'react-query';
import { useUserStore } from '~/store/index';
import { fetchApi } from '~/utils/fetchApi';

export function useQueryMe() {
  const user = useUserStore();

  const { data, isLoading } = useQuery('user', () => fetchApi<ApiGetUsersMeResult>({ path: '/users/@me' }).catch(() => null));

  console.log({ data });

  useEffect(() => {
    if (user.loggedIn === null && data) {
      user.setUser({
        loggedIn: true,
        id: data.id,
        username: data.username,
        avatar: data.avatar,
        // TODO(DD)
        guilds: []
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return { data, isLoading };
}
