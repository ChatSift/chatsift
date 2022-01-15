import type { ApiGetUsersMeResult } from '@automoderator/core';
import { useEffect } from 'react';
import { useQuery } from 'react-query';
import { useUserStore } from '~/store/index';
import { fetchApi } from '~/utils/fetchApi';

export function useQueryMe() {
	const user = useUserStore();

	const { data, isLoading } = useQuery('user', () =>
		fetchApi<ApiGetUsersMeResult>({ path: '/users/@me' }).catch(() => null),
	);

	useEffect(() => {
		if (user.loggedIn === null && data) {
			user.setUser({
				loggedIn: true,
				id: data.id,
				username: data.username,
				discriminator: data.discriminator,
				avatar: data.avatar,
				guilds: data.guilds.map((guild) => ({ id: guild.id, icon: guild.icon, name: guild.name })),
			});
		}
	}, [data]);

	return { user: data, isLoading };
}
