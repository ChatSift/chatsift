import { DiscordPermissions } from '../DiscordPermissions';

test('construct', () => {
  expect(new DiscordPermissions([]).valueOf()).toBe(0n);
});

test('any', () => {
  expect(new DiscordPermissions(['manageGuild', 'manageMessages']).any(['manageGuild', 'manageEmojis'])).toBe(true);
  expect(new DiscordPermissions(['manageGuild']).any('administrator', false)).toBe(false);
});

test('has', () => {
  expect(new DiscordPermissions('administrator').has('attachFiles')).toBe(true);
  expect(new DiscordPermissions('manageMessages').has('administrator', false)).toBe(false);
});
