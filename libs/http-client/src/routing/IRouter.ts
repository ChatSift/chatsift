export type IRouter = {
  get<T>(): Promise<T>;
  post<T, D>(data: D): Promise<T>;
  patch<T, D>(data: D): Promise<T>;
  put<T, D>(data: D): Promise<T>;
  delete<T>(): Promise<T>;
} & { [key: string]: IRouter };
