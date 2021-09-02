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
