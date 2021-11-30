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
import ChannelInput from '~/components/ChannelInput';

const Loading = dynamic(() => import('~/components/Loading'));

const LoggingSettings = () => {
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
        <ChannelInput settings = {settings}
          name = {'Mod logs channel'}
          settingsKey = {'mod_action_log_channel'}
          guild = {guild}
          form = {form}
          textOnly />

        <ChannelInput settings = {settings}
          name = {'Filter logs channel'}
          settingsKey = {'filter_trigger_log_channel'}
          guild = {guild}
          form = {form}
          textOnly />

        <ChannelInput settings = {settings}
          name = {'User logs channel'}
          settingsKey = {'user_update_log_channel'}
          guild = {guild}
          form = {form}
          textOnly />

        <ChannelInput settings = {settings}
          name = {'Message logs'}
          settingsKey = {'message_update_log_channel'}
          guild = {guild}
          form = {form}
          textOnly
        />

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

export default LoggingSettings;
