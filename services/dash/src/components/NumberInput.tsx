import { useState } from 'react';
import {
  FormControl,
  FormLabel,
  Input,
  FormErrorMessage,
  FormErrorIcon,
  Button,
  HStack,
  Box
} from '@chakra-ui/react';
import { UseFormReturn } from 'react-hook-form';
import type { ApiPatchGuildSettingsBody, GuildSettings, UserGuild } from '@automoderator/core';
import { fetchApi } from '~/utils/fetchApi';

// TODO(DD): consider generalizing
interface NumberInputProps {
  settings: GuildSettings;
  name: string;
  settingsKey: Exclude<keyof GuildSettings, 'guild_id'>;
  required?: boolean;
  guild: UserGuild;
  form: UseFormReturn<ApiPatchGuildSettingsBody>;
  min?: number;
  max?: number;
}

const NumberInput = ({
  settings,
  name,
  settingsKey,
  required,
  guild,
  form: { register, formState: { errors } },
  min,
  max
}: NumberInputProps) => {
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
        <Input {...register(settingsKey, {
          required: { value: required ?? false, message: 'Please input a number' },
          min: { value: min ?? -Infinity, message: `Please input a number greater than or equal to ${min}` },
          max: { value: max ?? Infinity, message: `Please input a number lower than or equal to ${max}` },
          // @ts-expect-error
          validate: (value?: string) => {
            if (value?.length && isNaN(Number(value))) {
              return 'Please input a valid number';
            }
          }
        })}
        placeholder = {name}
        defaultValue = {(settings[settingsKey] ?? undefined) as string}
        />
        <FormErrorMessage>
          <FormErrorIcon />
          {errors[settingsKey]?.message}
        </FormErrorMessage>
      </FormControl>
    </HStack>
  );
};

export default NumberInput;
