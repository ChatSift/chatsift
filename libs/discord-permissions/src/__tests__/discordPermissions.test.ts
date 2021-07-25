import { container } from 'tsyringe';
import { PermissionsChecker, UserPerms, PermissionsCheckerData } from '../PermissionsChecker';
import { kLogger, kSql } from '@automoderator/injection';
import { Rest } from '@cordis/rest';

const sqlMock = jest.fn().mockImplementation(() => Promise.resolve([]));
const restGetMock = jest.fn();
const loggerWarnMock = jest.fn();

const restMock: jest.Mocked<Rest> = { get: restGetMock } as any;

container.register(kSql, { useValue: sqlMock });
container.register(kLogger, { useValue: { warn: loggerWarnMock } });
container.register(Rest, { useValue: restMock });

const checker = container.resolve(PermissionsChecker);

const makeMockedInteraction = (data: any): PermissionsCheckerData => data;

afterEach(() => jest.clearAllMocks());

describe('owner needed', () => {
  const data = makeMockedInteraction({
    guild_id: '123',
    member: {
      user: {
        id: '123'
      }
    }
  });

  test('when GET throws', async () => {
    restGetMock.mockImplementation(() => Promise.reject());

    expect(await checker.check(data, UserPerms.owner)).toBe(false);
    expect(loggerWarnMock).toHaveBeenCalled();
  });

  test('ID check', async () => {
    restGetMock.mockImplementation(() => Promise.resolve({ owner_id: '123' }));

    expect(await checker.check(data, UserPerms.owner)).toBe(true);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });
});

describe('admin neeaded', () => {
  const getInteraction = (permissions: string) => makeMockedInteraction({
    guild_id: '123',
    member: {
      user: {
        id: '123'
      },
      permissions
    }
  });

  test('simple perm check passes', async () => {
    expect(await checker.check(getInteraction('8'), UserPerms.admin)).toBe(true);
  });

  test('owner fallback', async () => {
    restGetMock.mockImplementation(() => Promise.resolve({ owner_id: '1234' }));

    expect(await checker.check(getInteraction('0'), UserPerms.admin)).toBe(false);
  });
});

describe('mod needed', () => {
  const getInteraction = (permissions: string) => makeMockedInteraction({
    guild_id: '123',
    member: {
      user: {
        id: '123'
      },
      roles: ['123'],
      permissions
    }
  });

  test('pass by admin test', async () => {
    expect(await checker.check(getInteraction('8'), UserPerms.mod)).toBe(true);
  });


  test('pass by mod check', async () => {
    sqlMock.mockImplementation(() => Promise.resolve([{ mod_role: '123' }]));
    expect(await checker.check(getInteraction('0'), UserPerms.mod)).toBe(true);
  });

  test('pass by owner check', async () => {
    sqlMock.mockImplementation(() => Promise.resolve([{ mod_role: '1234' }]));
    restGetMock.mockImplementation(() => Promise.resolve({ owner_id: '123' }));

    expect(await checker.check(getInteraction('0'), UserPerms.mod)).toBe(true);
  });
});

test('no perms needed', async () => {
  expect(await checker.check(makeMockedInteraction({}), UserPerms.none)).toBe(true);
});
