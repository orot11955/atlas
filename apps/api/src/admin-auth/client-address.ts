export interface ClientRequest {
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
}

export function resolveClientAddress(request: ClientRequest): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}
