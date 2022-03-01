import { useQuerySettings } from '~/hooks/useQuerySettings';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Button, ButtonGroup } from '@chakra-ui/react';
import { useForm } from 'react-hook-form';
import type { FormEvent } from 'react';
import { useQueryMe } from '~/hooks/useQueryMe';
import type { PatchGuildsSettingsBody } from '@chatsift/api-wrapper/v2';
import { fetchApi } from '~/utils/fetchApi';
import { filterEmptyFields } from '~/utils/filterEmptyFields';
import NumberInput from '~/components/NumberInput';
import DurationInput from '~/components/DurationInput';
import SwitchInput from '~/components/SwitchInput';
import ms from '@naval-base/ms';

const Loading = dynamic(() => import('~/components/Loading'));

const AutoModerationSettings = () => {
	const router = useRouter();
	const { id } = router.query as { id: string };

	const { user } = useQueryMe();
	const { settings } = useQuerySettings(id);

	const guild = user?.guilds.find((g) => g.id === id);

	const form = useForm<PatchGuildsSettingsBody>();

	if (!settings) {
		return <Loading />;
	}

	const handleOnSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		await form.handleSubmit(async (values: PatchGuildsSettingsBody) => {
			const body = filterEmptyFields(values);

			if (body.minJoinAge != null) {
				// TODO(DD): Figure out a better way to approach this rather than an any cast
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				body.minJoinAge = ms(body.minJoinAge) as any;
			}

			await fetchApi<unknown, PatchGuildsSettingsBody>({
				path: `/guilds/${id}/settings`,
				method: 'PATCH',
				body,
			});
		})(event);
	};

	return guild?.data ? (
		<form onSubmit={handleOnSubmit}>
			<NumberInput
				settings={settings}
				name={'Automatically pardon warns after (days)'}
				settingsKey={'autoPardonWarnsAfter'}
				guild={guild}
				form={form}
			/>

			<DurationInput
				settings={settings}
				name={'Automatically kick users with accounts younger than'}
				settingsKey={'minJoinAge'}
				guild={guild}
				form={form}
			/>

			<NumberInput
				settings={settings}
				name={"Automod cooldown (how long to wait before decreasing a user's automod trigger total; in minutes)"}
				settingsKey={'automodCooldown'}
				guild={guild}
				form={form}
				min={3}
				max={180}
			/>

			<SwitchInput
				settings={settings}
				name={'Automatically kick users with blank avatars'}
				settingsKey={'noBlankAvatar'}
				guild={guild}
				form={form}
			/>

			<ButtonGroup d="flex" justifyContent="flex-end" pt={2}>
				<Button
					type="submit"
					colorScheme="green"
					isLoading={form.formState.isSubmitting}
					loadingText="Submitting"
					isDisabled={form.formState.isSubmitting}
				>
					Save
				</Button>
			</ButtonGroup>
		</form>
	) : null;
};

export default AutoModerationSettings;
