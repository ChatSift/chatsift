import { kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import { container } from 'tsyringe';
import { PermissionsChecker, PermissionsCheckerData, UserPerms } from '../PermissionsChecker';

const modRoleMock = jest.fn().mockImplementation(() => Promise.resolve([]));
const adminRoleMock = jest.fn().mockImplementation(() => Promise.resolve([]));
const restGetMock = jest.fn();
const loggerWarnMock = jest.fn();

const restMock = { get: restGetMock } as unknown as jest.Mocked<Rest>;

// TODO(DD): Look into proper prisma mocking: https://www.prisma.io/docs/guides/testing/unit-testing
container.register<any>(PrismaClient, {
	useValue: { modRole: { findMany: modRoleMock }, adminRole: { findMany: adminRoleMock } },
});
container.register(kLogger, { useValue: { warn: loggerWarnMock } });
container.register(kConfig, { useValue: { devIds: ['223703707118731264'] } });
container.register(Rest, { useValue: restMock });

const checker = container.resolve(PermissionsChecker);

const makeMockedInteraction = (data: any): PermissionsCheckerData => data as PermissionsCheckerData;

afterEach(() => jest.clearAllMocks());

test('dev bypass', async () => {
	const data = makeMockedInteraction({
		member: {
			user: {
				id: '223703707118731264',
			},
		},
	});

	expect(await checker.check(data, UserPerms.owner)).toBe(true);
});

describe('owner needed', () => {
	const data = makeMockedInteraction({
		guild_id: '123',
		member: {
			user: {
				id: '123',
			},
		},
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
	const getInteraction = (permissions: string) =>
		makeMockedInteraction({
			guild_id: '123',
			member: {
				user: {
					id: '123',
				},
				roles: [],
				permissions,
			},
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
	const getInteraction = (permissions: string) =>
		makeMockedInteraction({
			guild_id: '123',
			member: {
				user: {
					id: '123',
				},
				roles: ['123'],
				permissions,
			},
		});

	test('pass by admin test', async () => {
		expect(await checker.check(getInteraction('8'), UserPerms.mod)).toBe(true);
	});

	test('pass by mod check', async () => {
		modRoleMock.mockImplementation(() => Promise.resolve([{ roleId: '123' }]));
		expect(await checker.check(getInteraction('0'), UserPerms.mod)).toBe(true);
	});

	test('pass by owner check', async () => {
		modRoleMock.mockImplementation(() => Promise.resolve([{ roleId: '1234' }]));
		restGetMock.mockImplementation(() => Promise.resolve({ owner_id: '123' }));

		expect(await checker.check(getInteraction('0'), UserPerms.mod)).toBe(true);
	});
});

test('no perms needed', async () => {
	const data = makeMockedInteraction({
		member: {
			user: {
				id: '123',
			},
		},
	});

	expect(await checker.check(data, UserPerms.none)).toBe(true);
});
