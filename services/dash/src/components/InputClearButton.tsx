import type { ApiPatchGuildSettingsBody, GuildSettings } from '@automoderator/core';
import { Box, Button } from '@chakra-ui/react';
import { useState } from 'react';
import { fetchApi } from '../utils/fetchApi';
import type { Snowflake } from 'discord-api-types/v9';

const InputClearButton = ({ settingsKey, guild }: { settingsKey: Exclude<keyof GuildSettings, 'guild_id'>; guild: Snowflake }) => {
  const [isClearing, setIsClearing] = useState<boolean>(false);

  return (
    <Box>
      <Button type = "button"
        colorScheme = "red"
        isLoading = {isClearing}
        loadingText = "Clearing"
        isDisabled = {isClearing}
        onClick = {async () => {
          setIsClearing(true);
          await fetchApi<unknown, ApiPatchGuildSettingsBody>({ path: `/guilds/${guild}/settings`, method: 'PATCH', body: { [settingsKey]: null } });
          setIsClearing(false);
        }}
      >
        Clear
      </Button>
    </Box>
  );
};

export default InputClearButton;
