import { ApiGetGuildsSettingsResult } from '@automoderator/core';
import type { Snowflake } from 'discord-api-types/v9';
import { useQuery } from 'react-query';
import { fetchApi } from '~/utils/fetchApi';

// TODO(DD): Consider store usage
export function useQuerySettings(id: Snowflake) {
	const { data, error } = useQuery(`settings_${id}`, () =>
		fetchApi<ApiGetGuildsSettingsResult>({ path: `/guilds/${id}/settings` }).catch(() => null),
	);
	return { settings: data, error };
}
