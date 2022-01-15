import { useQuerySettings } from '~/hooks/useQuerySettings';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Button, ButtonGroup } from '@chakra-ui/react';
import { useForm } from 'react-hook-form';
import { FormEvent } from 'react';
import { useQueryMe } from '~/hooks/useQueryMe';
import type { ApiPatchGuildSettingsBody } from '@automoderator/core';
import { fetchApi } from '~/utils/fetchApi';
import RoleInput from '~/components/RoleInput';
import ChannelInput from '~/components/ChannelInput';

const Loading = dynamic(() => import('~/components/Loading'));

const GuildSettings = () => {
	const router = useRouter();
	const { id } = router.query as { id: string };

	const { user } = useQueryMe();
	const { settings } = useQuerySettings(id);

	const guild = user?.guilds.find((g) => g.id === id);

	const form = useForm<ApiPatchGuildSettingsBody>();

	if (!settings) {
		return <Loading />;
	}

	const handleOnSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		await form.handleSubmit(async (values: ApiPatchGuildSettingsBody) => {
			await fetchApi<unknown, ApiPatchGuildSettingsBody>({
				path: `/guilds/${id}/settings`,
				method: 'PATCH',
				body: values,
			});
		})(event);
	};

	return guild?.data ? (
		<form onSubmit={handleOnSubmit}>
			<RoleInput settings={settings} name={'Mod role'} settingsKey={'mod_role'} guild={guild} form={form} />

			<RoleInput settings={settings} name={'Admin role'} settingsKey={'admin_role'} guild={guild} form={form} />

			<RoleInput settings={settings} name={'Mute role'} settingsKey={'mute_role'} guild={guild} form={form} />

			<ChannelInput
				settings={settings}
				name={'Reports channel'}
				settingsKey={'reports_channel'}
				guild={guild}
				form={form}
				textOnly
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

export default GuildSettings;
