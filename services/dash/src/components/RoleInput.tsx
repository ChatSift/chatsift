import {
  FormControl,
  FormLabel,
  Select,
  FormErrorMessage,
  FormErrorIcon,
  HStack
} from '@chakra-ui/react';
import { UseFormReturn } from 'react-hook-form';
import type { ApiPatchGuildSettingsBody, GuildSettings, UserGuild } from '@automoderator/core';
import InputClearButton from '~/components/InputClearButton';

interface RoleInputProps {
  settings: GuildSettings;
  name: string;
  settingsKey: Exclude<keyof GuildSettings, 'guild_id'>;
  required?: boolean;
  guild: UserGuild;
  form: UseFormReturn<ApiPatchGuildSettingsBody>;
}

const RoleInput = ({
  settings,
  name,
  settingsKey,
  required,
  guild,
  form: { register, formState: { errors } }
}: RoleInputProps) => (
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

      <Select {...register(settingsKey, {
        required: { value: required ?? false, message: 'Please select a role' }
      })}
      placeholder = {name}
      defaultValue = {(settings[settingsKey] ?? undefined) as string}
      >
        {
          guild.data?.roles
            .sort((a, b) => b.position - a.position)
            .map(role => (
              <option value = {role.id} key = {role.id}>
                {role.name}
              </option>
            ))
        }
      </Select>
    </HStack>
  </FormControl>
);

export default RoleInput;
