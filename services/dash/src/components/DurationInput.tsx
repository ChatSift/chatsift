import {
  FormControl,
  FormLabel,
  Input,
  FormErrorMessage,
  FormErrorIcon,
  HStack
} from '@chakra-ui/react';
import { UseFormReturn } from 'react-hook-form';
import { ApiPatchGuildSettingsBody, GuildSettings, ms, UserGuild } from '@automoderator/core';
import InputClearButton from '~/components/InputClearButton';

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
}: DurationInputProps) => (
  <FormControl id = {settingsKey} isInvalid = {Boolean(errors[settingsKey])}>
    <FormLabel>
      {name}
    </FormLabel>

    <FormErrorMessage>
      <FormErrorIcon />
      {errors[settingsKey]?.message}
    </FormErrorMessage>

    <HStack mb = {4}>
      <InputClearButton settingsKey = {settingsKey} guild = {guild.id} />

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
    </HStack>
  </FormControl>
);

export default DurationInput;
