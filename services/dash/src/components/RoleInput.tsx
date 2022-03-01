import { FormControl, FormLabel, Select, FormErrorMessage, FormErrorIcon, HStack } from '@chakra-ui/react';
import type { UseFormReturn } from 'react-hook-form';
import type { PatchGuildsSettingsBody, UserGuild } from '@chatsift/api-wrapper/v2';
import InputClearButton from '~/components/InputClearButton';
import type { GuildSettings } from '@prisma/client';

interface RoleInputProps {
	settings: GuildSettings;
	name: string;
	settingsKey: Exclude<keyof GuildSettings, 'guildId'>;
	required?: boolean;
	guild: UserGuild;
	form: UseFormReturn<PatchGuildsSettingsBody>;
}

const RoleInput = ({
	settings,
	name,
	settingsKey,
	required,
	guild,
	form: {
		register,
		formState: { errors },
	},
}: RoleInputProps) => (
	<FormControl id={settingsKey} isInvalid={Boolean(errors[settingsKey])}>
		<FormLabel>{name}</FormLabel>

		<FormErrorMessage>
			<FormErrorIcon />
			{errors[settingsKey]?.message}
		</FormErrorMessage>

		<HStack mb={4}>
			<InputClearButton settingsKey={settingsKey} guild={guild.id} />

			<Select
				{...register(settingsKey, {
					required: { value: required ?? false, message: 'Please select a role' },
				})}
				placeholder={name}
				defaultValue={(settings[settingsKey] ?? undefined) as string}
			>
				{guild.data?.roles
					.sort((a, b) => b.position - a.position)
					.map((role) => (
						<option value={role.id} key={role.id}>
							{role.name}
						</option>
					))}
			</Select>
		</HStack>
	</FormControl>
);

export default RoleInput;
