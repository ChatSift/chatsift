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
import { ApiPatchGuildSettingsBody, ms } from '@automoderator/core';
import { fetchApi } from '~/utils/fetchApi';
import { filterEmptyFields } from '~/utils/filterEmptyFields';
import NumberInput from '~/components/NumberInput';
import DurationInput from '~/components/DurationInput';
import SwitchInput from '~/components/SwitchInput';

const Loading = dynamic(() => import('~/components/Loading'));

const AutoModerationSettings = () => {
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
      const body = filterEmptyFields(values);

      if (body.min_join_age != null) {
        body.min_join_age = ms(body.min_join_age) as any;
      }

      await fetchApi<unknown, ApiPatchGuildSettingsBody>({
        path: `/guilds/${id}/settings`,
        method: 'PATCH',
        body
      });
    })(event);
  };

  return guild?.data
    ? (
      <form onSubmit = {handleOnSubmit}>
        <NumberInput settings = {settings}
          name = {'Automatically pardon warns after (days)'}
          settingsKey = {'auto_pardon_warns_after'}
          guild = {guild}
          form = {form}
        />

        <DurationInput settings = {settings}
          name = {'Automatically kick users with accounts younger than'}
          settingsKey = {'min_join_age'}
          guild = {guild}
          form = {form}
        />

        <NumberInput settings = {settings}
          name = {'Automod cooldown (how long to wait before decreasing a user\'s automod trigger total; in minutes)'}
          settingsKey = {'automod_cooldown'}
          guild = {guild}
          form = {form}
          min = {3}
          max = {180}
        />

        <SwitchInput settings = {settings}
          name = {'Automatically kick users with blank avatars'}
          settingsKey = {'no_blank_avatar'}
          guild = {guild}
          form = {form}
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

export default AutoModerationSettings;
