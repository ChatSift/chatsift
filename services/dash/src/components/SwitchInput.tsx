import { FormControl, FormLabel, Switch, FormErrorMessage, FormErrorIcon, HStack } from '@chakra-ui/react';
import { UseFormReturn } from 'react-hook-form';
import { ApiPatchGuildSettingsBody, GuildSettings, UserGuild } from '@automoderator/core';

// TODO(DD): consider generalizing
interface SwitchInputProps {
	settings: GuildSettings;
	name: string;
	settingsKey: Exclude<keyof GuildSettings, 'guild_id'>;
	guild: UserGuild;
	form: UseFormReturn<ApiPatchGuildSettingsBody>;
}

const SwitchInput = ({
	settings,
	name,
	settingsKey,
	form: {
		register,
		formState: { errors },
	},
}: SwitchInputProps) => (
	<HStack mb={4}>
		<FormControl id={settingsKey} isInvalid={Boolean(errors[settingsKey])}>
			<FormLabel>{name}</FormLabel>

			<Switch
				size="lg"
				{...register(settingsKey)}
				placeholder={name}
				defaultValue={(settings[settingsKey] ?? false) as any}
			/>

			<FormErrorMessage>
				<FormErrorIcon />
				{errors[settingsKey]?.message}
			</FormErrorMessage>
		</FormControl>
	</HStack>
);

export default SwitchInput;
