export type OneOf<T extends Record<string, any>, K1 extends keyof T, K2 extends keyof T> = {
  [Key in keyof T]: Key extends K1
    ? Exclude<T[Key], null>
    : Key extends K2
      ? null
      : T[Key]
} | {
  [Key in keyof T]: Key extends K2
    ? Exclude<T[Key], null>
    : Key extends K1
      ? null
      : T[Key]
};

export type ExtractArrayT<Ts> = Ts extends (infer T)[] ? T : never;

export const groupBy = <T, R extends string>(array: T[], grouper: (element: T) => R): Record<R, T[]> => {
  const grouped = {} as Record<R, T[]>; // eslint-disable-line @typescript-eslint/consistent-type-assertions

  for (const element of array) {
    (grouped[grouper(element)] ??= []).push(element);
  }

  return grouped;
};

export const sectionArray = <T>(array: T[], amount: number): T[][] => {
  const out: T[][] = [];
  let pushed = 0;
  let i = 0;

  for (const element of array) {
    (out[i] ??= []).push(element);
    if (++pushed === amount) {
      pushed = 0;
      i++;
    }
  }

  return out;
};
