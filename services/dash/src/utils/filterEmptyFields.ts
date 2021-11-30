export const filterEmptyFields = <T extends Record<string, any>>(obj: T): T => Object.fromEntries(
  Object
    .entries(obj)
    .filter(([, value]) => typeof value !== 'string' || value.length)
) as unknown as T;
