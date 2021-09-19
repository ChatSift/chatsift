import { ms } from '../ms';

const ONE_DAY = 86400000 as const;
const ONE_WEEK = ONE_DAY * 7;
const EIGHT_DAYS = ONE_WEEK + ONE_DAY;

test('string -> number', () => {
  expect(ms('1w1d')).toBe(EIGHT_DAYS);
});

describe('number -> string', () => {
  test('short', () => {
    expect(ms(ONE_DAY)).toBe('1d');
  });

  test('long', () => {
    expect(ms(EIGHT_DAYS, true)).toBe('8 days');
  });
});

test('bad type', () => {
  // @ts-expect-error
  expect(() => ms(true)).toThrow(TypeError);
});
