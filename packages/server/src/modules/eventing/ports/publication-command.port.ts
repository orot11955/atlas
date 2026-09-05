export interface PublicationCommandPort {
  publish(
    workspaceId: string,
    contentId: string,
    contentSiteId: string,
  ): Promise<Readonly<{ replayed: boolean }>>;
  withdraw(workspaceId: string, contentId: string, contentSiteId: string): Promise<unknown>;
}
