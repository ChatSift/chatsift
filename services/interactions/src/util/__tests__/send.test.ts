import { Rest } from '@cordis/rest';
import { container } from 'tsyringe';
import { send } from '../';
import { InteractionResponseType, Routes } from 'discord-api-types/v9';
import { kConfig } from '@automoderator/injection';
import type { Response } from 'polka';

const mockedPost = jest.fn();
const mockedPatch = jest.fn();
const mockedResEnd = jest.fn();

const mockedRest: jest.Mocked<Rest> = {
  post: mockedPost,
  patch: mockedPatch,
  make: (req: any) => mockedPatch(req.path, { data: req.data })
} as any;
const mockedRes: jest.Mocked<Response> = { end: mockedResEnd } as any;

container.register(Rest, { useValue: mockedRest });
container.register(kConfig, { useValue: { discordClientId: '1234' } });

afterEach(() => jest.clearAllMocks());

describe('send interaction with no update', () => {
  test('with embed', async () => {
    await send({ id: '1234', token: 'test', res: mockedRes }, { content: 'test', embed: {} }, { update: false });

    expect(mockedResEnd).toHaveBeenCalledTimes(1);
    expect(mockedResEnd).toHaveBeenCalledWith(
      JSON.stringify(
        {
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content: 'test',
            embeds: [{}]
          }
        }
      )
    );
  });

  test('without embed with update', async () => {
    await send({ id: '1234', token: 'test' } as any, { content: 'test' }, { update: true });

    expect(mockedRest.patch).toHaveBeenCalledTimes(1);
    expect(mockedRest.patch).toHaveBeenCalledWith(
      Routes.webhookMessage('1234', 'test', '@original'),
      {
        data: {
          content: 'test'
        }
      }
    );
  });
});

test('send normal message', async () => {
  await send({ channel_id: '1234' } as any, { content: 'test' });

  expect(mockedRest.post).toHaveBeenCalledTimes(1);
  expect(mockedRest.post).toHaveBeenCalledWith(
    Routes.channelMessages('1234'),
    {
      data: {
        content: 'test'
      }
    }
  );
});
