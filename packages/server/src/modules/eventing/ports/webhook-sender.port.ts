export interface WebhookSendRequest {
  url: string;
  body: string;
  headers: Readonly<Record<string, string>>;
  timeoutMilliseconds: number;
}

export interface WebhookSendResponse {
  status: number;
  bodyExcerpt?: string;
}

export interface WebhookSenderPort {
  send(request: Readonly<WebhookSendRequest>): Promise<Readonly<WebhookSendResponse>>;
}
