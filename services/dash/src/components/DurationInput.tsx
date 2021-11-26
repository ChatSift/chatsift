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
import { ApiPatchGuildSettingsBody, GuildSettings, ms, UserGuild } from '@automoderator/core';
import { fetchApi } from '~/utils/fetchApi';

// TODO(DD): consider generalizing
interface DurationInputProps {
  settings: GuildSettings;
  name: string;
  settingsKey: Exclude<keyof GuildSettings, 'guild_id'>;
  required?: boolean;
  guild: UserGuild;
  form: UseFormReturn<ApiPatchGuildSettingsBody>;
}

const DurationInput = ({
  settings,
  name,
  settingsKey,
  required,
  guild,
  form: { register, formState: { errors } }
}: DurationInputProps) => {
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
          required: { value: required ?? false, message: 'Please input a duration' },
          // @ts-expect-error
          validate: (value?: string) => {
            if (value == null) {
              return;
            }

            try {
              const duration = ms(value);

              if (value !== '0' && duration === 0) {
                return 'Please input a valid duration';
              }
            } catch {}
          }
        })}
        placeholder = {name}
        defaultValue = {(settings[settingsKey] == null ? undefined : ms(settings[settingsKey] as any, true))}
        />
        <FormErrorMessage>
          <FormErrorIcon />
          {errors[settingsKey]?.message}
        </FormErrorMessage>
      </FormControl>
    </HStack>
  );
};

export default DurationInput;
