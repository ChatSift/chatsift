import { FormControl, FormLabel, Switch, FormErrorMessage, FormErrorIcon, HStack } from '@chakra-ui/react';
import type { UseFormReturn } from 'react-hook-form';
import type { PatchGuildsSettingsBody, UserGuild } from '@chatsift/api-wrapper/v2';
import type { GuildSettings } from '@prisma/client';

// TODO(DD): consider generalizing
interface SwitchInputProps {
	settings: GuildSettings;
	name: string;
	settingsKey: Exclude<keyof GuildSettings, 'guildId'>;
	guild: UserGuild;
	form: UseFormReturn<PatchGuildsSettingsBody>;
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
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				defaultValue={settings[settingsKey] ?? (false as any)}
			/>

			<FormErrorMessage>
				<FormErrorIcon />
				{errors[settingsKey]?.message}
			</FormErrorMessage>
		</FormControl>
	</HStack>
);

export default SwitchInput;
