import { FormControl, FormLabel, Input, FormErrorMessage, FormErrorIcon, HStack } from '@chakra-ui/react';
import type { UseFormReturn } from 'react-hook-form';
import type { PatchGuildsSettingsBody, UserGuild } from '@chatsift/api-wrapper/v2';
import InputClearButton from '~/components/InputClearButton';
import type { GuildSettings } from '@prisma/client';
import ms from '@naval-base/ms';

// TODO(DD): consider generalizing
interface DurationInputProps {
	settings: GuildSettings;
	name: string;
	settingsKey: Exclude<keyof GuildSettings, 'guildId'>;
	required?: boolean;
	guild: UserGuild;
	form: UseFormReturn<PatchGuildsSettingsBody>;
}

const DurationInput = ({
	settings,
	name,
	settingsKey,
	required,
	guild,
	form: {
		register,
		formState: { errors },
	},
}: DurationInputProps) => (
	<FormControl id={settingsKey} isInvalid={Boolean(errors[settingsKey])}>
		<FormLabel>{name}</FormLabel>

		<FormErrorMessage>
			<FormErrorIcon />
			{errors[settingsKey]?.message}
		</FormErrorMessage>

		<HStack mb={4}>
			<InputClearButton settingsKey={settingsKey} guild={guild.id} />

			<Input
				{...register(settingsKey, {
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
					},
				})}
				placeholder={name}
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				defaultValue={settings[settingsKey] == null ? undefined : ms(settings[settingsKey] as any, true)}
			/>
		</HStack>
	</FormControl>
);

export default DurationInput;
