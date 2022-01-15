import { FormControl, FormLabel, Input, FormErrorMessage, FormErrorIcon, HStack } from '@chakra-ui/react';
import type { UseFormReturn } from 'react-hook-form';
import type { ApiPatchGuildSettingsBody, GuildSettings, UserGuild } from '@automoderator/core';
import InputClearButton from '~/components/InputClearButton';

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
	form: {
		register,
		formState: { errors },
	},
	min,
	max,
}: NumberInputProps) => (
	<FormControl id={settingsKey} isInvalid={Boolean(errors[settingsKey])}>
		<FormLabel>{name}</FormLabel>

		<FormErrorMessage p={2} pl={20}>
			<FormErrorIcon />
			{errors[settingsKey]?.message}
		</FormErrorMessage>

		<HStack mb={4}>
			<InputClearButton settingsKey={settingsKey} guild={guild.id} />

			<Input
				{...register(settingsKey, {
					required: { value: required ?? false, message: 'Please input a number' },
					min: { value: min ?? -Infinity, message: `Please input a number greater than or equal to ${min}` },
					max: { value: max ?? Infinity, message: `Please input a number lower than or equal to ${max}` },
					// @ts-expect-error
					validate: (value?: string) => {
						if (value?.length && isNaN(Number(value))) {
							return 'Please input a valid number';
						}
					},
				})}
				placeholder={name}
				defaultValue={(settings[settingsKey] ?? undefined) as string}
			/>
		</HStack>
	</FormControl>
);

export default NumberInput;
