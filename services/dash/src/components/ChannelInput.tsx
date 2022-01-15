import { FormControl, FormLabel, Select, FormErrorMessage, FormErrorIcon, HStack } from '@chakra-ui/react';
import { UseFormReturn } from 'react-hook-form';
import { ApiPatchGuildSettingsBody, GuildSettings, UserGuild, sortChannels } from '@automoderator/core';
import InputClearButton from '~/components/InputClearButton';

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
	form: {
		register,
		formState: { errors },
	},
	textOnly,
}: ChannelInputProps) => (
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
				{sortChannels(guild.data?.channels ?? [])
					.filter((channel) => !textOnly || channel.type === 0)
					.map((channel) => (
						<option value={channel.id} key={channel.id}>
							{`${channel.type === 0 ? '#' : ''}${channel.name}`}
						</option>
					))}
			</Select>
		</HStack>
	</FormControl>
);

export default ChannelInput;
