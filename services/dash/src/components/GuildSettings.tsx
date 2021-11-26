import { useQuerySettings } from '~/hooks/useQuerySettings';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import {
  Button,
  ButtonGroup,
  Heading,
  Center,
  Box,
  Link
} from '@chakra-ui/react';
import { useForm } from 'react-hook-form';
import { FormEvent } from 'react';
import { useQueryMe } from '~/hooks/useQueryMe';
import type { ApiPatchGuildSettingsBody } from '@automoderator/core';
import { fetchApi } from '~/utils/fetchApi';
import RoleInput from '~/components/RoleInput';

const Loading = dynamic(() => import('~/components/Loading'));

const GuildSettings = () => {
  const router = useRouter();
  const { id } = router.query as { id: string };

  const { user } = useQueryMe();
  const { settings } = useQuerySettings(id);

  const guild = user?.guilds.find(g => g.id === id);

  const form = useForm<ApiPatchGuildSettingsBody>();

  if (!settings) {
    return (
      <Loading />
    );
  }

  const handleOnSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await form.handleSubmit(async (values: ApiPatchGuildSettingsBody) => {
      await fetchApi<unknown, ApiPatchGuildSettingsBody>({ path: `/guilds/${id}/settings`, method: 'PATCH', body: values });
    })(event);
  };

  return guild?.data
    ? (
      <form onSubmit = {handleOnSubmit}>
        <RoleInput settings = {settings}
          name = {'Mod role'}
          settingsKey = {'mod_role'}
          guild = {guild}
          form = {form} />

        <RoleInput settings = {settings}
          name = {'Admin role'}
          settingsKey = {'admin_role'}
          guild = {guild}
          form = {form} />

        <RoleInput settings = {settings}
          name = {'Mute role'}
          settingsKey = {'mute_role'}
          guild = {guild}
          form = {form} />

        <ButtonGroup d = "flex"
          justifyContent = "flex-end"
          pt = {2}>
          <Button type = "submit"
            colorScheme = "green"
            isLoading = {form.formState.isSubmitting}
            loadingText = "Submitting"
            isDisabled = {form.formState.isSubmitting}
          >
            Save
          </Button>
        </ButtonGroup>
      </form>
    )
    : (
      <Center>
        <Box my = {{ base: 12 }} px = {{ base: 50, xl: 150 }}
          textAlign = "center">
          <Heading fontSize = "xl" mb = {6}>
            {'AutoModerator is not in this guild yet'}
          </Heading>
          <Link target = "_blank" href = {process.env.NEXT_PUBLIC_INVITE_LINK}>
            <Button>
              Invite AutoModerator
            </Button>
          </Link>
        </Box>
      </Center>
    );
};

export default GuildSettings;
