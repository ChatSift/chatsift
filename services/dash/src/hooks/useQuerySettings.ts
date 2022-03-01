import type { GetGuildsSettingsResult } from '@chatsift/api-wrapper/v2';
import type { Snowflake } from 'discord-api-types/v9';
import { useQuery } from 'react-query';
import { fetchApi } from '~/utils/fetchApi';

// TODO(DD): Consider store usage
export function useQuerySettings(id: Snowflake) {
	const { data, error } = useQuery(`settings_${id}`, () =>
		fetchApi<GetGuildsSettingsResult>({ path: `/guilds/${id}/settings` }).catch(() => null),
	);

	return { settings: data, error };
}
