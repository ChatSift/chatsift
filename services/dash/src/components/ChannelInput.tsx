import { useState } from 'react';
import {
  FormControl,
  FormLabel,
  Select,
  FormErrorMessage,
  FormErrorIcon,
  Button,
  HStack,
  Box
} from '@chakra-ui/react';
import { UseFormReturn } from 'react-hook-form';
import { ApiPatchGuildSettingsBody, GuildSettings, UserGuild, sortChannels } from '@automoderator/core';
import { fetchApi } from '~/utils/fetchApi';

interface ChannelInputProps {
  settings: GuildSettings;
  name: string;
  settingsKey: Exclude<keyof GuildSettings, 'guild_id'>;
  required?: boolean;
  guild: UserGuild;
  form: UseFormReturn<ApiPatchGuildSettingsBody>;
  textOnly?: boolean;
}

const ChannelInput = ({
  settings,
  name,
  settingsKey,
  required,
  guild,
  form: { register, formState: { errors } },
  textOnly
}: ChannelInputProps) => {
  const [isClearing, setIsClearing] = useState<boolean>(false);

  return (
    <HStack mb = {4}>
      <Box pt = {8}>
        <Button type = "button"
          colorScheme = "red"
          isLoading = {isClearing}
          loadingText = "Clearing"
          isDisabled = {isClearing}
          onClick = {async () => {
            setIsClearing(true);
            await fetchApi<unknown, ApiPatchGuildSettingsBody>({ path: `/guilds/${guild.id}/settings`, method: 'PATCH', body: { [settingsKey]: null } });
            setIsClearing(false);
          }}
        >
          Clear
        </Button>
      </Box>

      <FormControl id = {settingsKey} isInvalid = {Boolean(errors[settingsKey])}>
        <FormLabel>
          {name}
        </FormLabel>
        <Select {...register(settingsKey, {
          required: { value: required ?? false, message: 'Please select a role' }
        })}
        placeholder = {name}
        defaultValue = {(settings[settingsKey] ?? undefined) as string}
        >
          {
            sortChannels(guild.data?.channels ?? [])
              .filter(channel => !textOnly || channel.type === 0)
              .map(channel => (
                <option value = {channel.id} key = {channel.id}>
                  {channel.name}
                </option>
              ))
          }
        </Select>
        <FormErrorMessage>
          <FormErrorIcon />
          {errors[settingsKey]?.message}
        </FormErrorMessage>
      </FormControl>
    </HStack>
  );
};

export default ChannelInput;
