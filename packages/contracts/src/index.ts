export type ApiMeta = {
  requestId: string;
  timestamp: string;
};

export type ApiResponse<T> = {
  data: T;
  meta: ApiMeta;
};

export type CursorMeta = ApiMeta & {
  nextCursor: string | null;
  hasNext: boolean;
};

export type CursorResponse<T> = {
  data: T[];
  meta: CursorMeta;
};

export type ProblemDetail = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId?: string;
  errors?: Record<string, string[]>;
};
