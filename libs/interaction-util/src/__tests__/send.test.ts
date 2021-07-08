import { Rest } from '@cordis/rest';
import { container } from 'tsyringe';
import { send } from '../';
import { Routes } from 'discord-api-types/v8';
import { kConfig } from '@automoderator/injection';

const mockedPost = jest.fn();
const mockedPatch = jest.fn();

const mockedRest: jest.Mocked<Rest> = { post: mockedPost, patch: mockedPatch } as any;

container.register(Rest, { useValue: mockedRest });
container.register(kConfig, { useValue: { discordClientId: '1234' } });

afterEach(() => jest.clearAllMocks());

describe('send interaction with default type/reply', () => {
  test('with embed', async () => {
    await send({ id: '1234', token: 'test' }, { content: 'test', embed: {} });

    expect(mockedRest.patch).toHaveBeenCalledTimes(1);
    expect(mockedRest.patch).toHaveBeenCalledWith(
      Routes.webhookMessage('1234', 'test', '@original'),
      {
        data: {
          content: 'test',
          embeds: [{}]
        }
      }
    );
  });

  test('without embed', async () => {
    await send({ id: '1234', token: 'test' } as any, { content: 'test' });

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

test('send normal', async () => {
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
