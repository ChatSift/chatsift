import type { PatchGuildsSettingsBody } from '@chatsift/api-wrapper/v2';
import { Box, Button } from '@chakra-ui/react';
import { useState } from 'react';
import { fetchApi } from '../utils/fetchApi';
import type { Snowflake } from 'discord-api-types/v9';
import type { GuildSettings } from '@prisma/client';

const InputClearButton = ({
	settingsKey,
	guild,
}: {
	settingsKey: Exclude<keyof GuildSettings, 'guildId'>;
	guild: Snowflake;
}) => {
	const [isClearing, setIsClearing] = useState<boolean>(false);

	return (
		<Box>
			<Button
				type="button"
				colorScheme="red"
				isLoading={isClearing}
				loadingText="Clearing"
				isDisabled={isClearing}
				onClick={async () => {
					setIsClearing(true);
					await fetchApi<unknown, PatchGuildsSettingsBody>({
						path: `/guilds/${guild}/settings`,
						method: 'PATCH',
						body: { [settingsKey]: null },
					});
					setIsClearing(false);
				}}
			>
				Clear
			</Button>
		</Box>
	);
};

export default InputClearButton;
