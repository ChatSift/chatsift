import { useQuerySettings } from '~/hooks/useQuerySettings';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Button, ButtonGroup } from '@chakra-ui/react';
import { useForm } from 'react-hook-form';
import type { FormEvent } from 'react';
import { useQueryMe } from '~/hooks/useQueryMe';
import type { PatchGuildsSettingsBody } from '@chatsift/api-wrapper/v2';
import { fetchApi } from '~/utils/fetchApi';
import NumberInput from '~/components/NumberInput';

const Loading = dynamic(() => import('~/components/Loading'));

const MentionSpamDetectionSettings = () => {
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
			await fetchApi<unknown, PatchGuildsSettingsBody>({
				path: `/guilds/${id}/settings`,
				method: 'PATCH',
				body: values,
			});
		})(event);
	};

	return guild?.data ? (
		<form onSubmit={handleOnSubmit}>
			<NumberInput
				settings={settings}
				name={'Amount of mentions needed to trigger'}
				settingsKey={'mentionAmount'}
				guild={guild}
				form={form}
				min={3}
			/>

			<NumberInput
				settings={settings}
				name={'How quickly the user has to reach the given amount of mentions (seconds)'}
				settingsKey={'mentionTime'}
				guild={guild}
				form={form}
				min={2}
				max={20}
			/>

			<NumberInput
				settings={settings}
				name={'How many mentions a user is allowed to send within a single message'}
				settingsKey={'mentionLimit'}
				guild={guild}
				form={form}
				min={2}
				max={20}
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

export default MentionSpamDetectionSettings;
