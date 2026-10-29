export type LooseError = { code?: string; message: string };

export type LooseResult<T> = {
  data: T;
  error: LooseError | null;
};

export type LooseQuery<T = unknown> = PromiseLike<LooseResult<T>> & {
  select(columns: string): LooseQuery<T>;
  eq(column: string, value: unknown): LooseQuery<T>;
  is(column: string, value: null): LooseQuery<T>;
  order(column: string, options?: { ascending?: boolean }): LooseQuery<T>;
  insert(values: unknown): LooseQuery<T>;
  update(values: unknown): LooseQuery<T>;
  delete(): LooseQuery<T>;
  maybeSingle(): Promise<LooseResult<T | null>>;
  single(): Promise<LooseResult<T>>;
};

export type LooseDb = {
  from<T = unknown>(table: string): LooseQuery<T>;
  rpc<T = unknown>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<LooseResult<T>>;
};
