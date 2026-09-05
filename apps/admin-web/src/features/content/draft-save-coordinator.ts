import type { Content, ContentCoverAsset } from './content-types';

export interface EditableDraft {
  title: string;
  summary: string;
  bodyMarkdown: string;
  cover: ContentCoverAsset | null;
}

export interface DraftSaveInput extends Omit<EditableDraft, 'summary'> {
  summary?: string;
  draftVersion: number;
}

export interface DraftSavePorts {
  load(): Promise<Content>;
  save(input: DraftSaveInput): Promise<Content>;
  revision(
    kind: 'checkpoint' | 'ready',
    input: { contentVersion: number; draftVersion: number; note?: string },
  ): Promise<Content>;
  restore(revisionId: string, draftVersion: number): Promise<Content>;
  archive(contentVersion: number): Promise<Content>;
  /** Only failures confirmed to reject before committing may resume after editing. */
  isValidationError?(error: unknown): boolean;
}

export interface DraftSaveSnapshot {
  content: Content | undefined;
  draft: Readonly<EditableDraft>;
  dirty: boolean;
  saving: boolean;
  locked: boolean;
  error: unknown;
  needsReload: boolean;
}

export class DraftOperationCancelled extends Error {
  public constructor() {
    super('The editor session is no longer active.');
  }
}

/** One queue owns every draft/version-changing command for one mounted editor. */
export class DraftSaveCoordinator {
  private snapshot: Readonly<DraftSaveSnapshot> = Object.freeze({
    content: undefined,
    draft: Object.freeze({ title: '', summary: '', bodyMarkdown: '', cover: null }),
    dirty: false,
    saving: false,
    locked: false,
    error: undefined,
    needsReload: false,
  });
  private readonly listeners = new Set<() => void>();
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private savedGeneration = 0;
  private exclusiveCount = 0;
  private epoch = 0;
  private active = true;
  private failureSerial = 0;

  public constructor(private readonly ports: DraftSavePorts) {}

  public readonly getSnapshot = (): Readonly<DraftSaveSnapshot> => this.snapshot;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public activate(): void {
    this.active = true;
  }

  public deactivate(): void {
    this.active = false;
    this.epoch += 1;
  }

  public edit(patch: Partial<EditableDraft>): boolean {
    if (!this.active || this.snapshot.locked || !this.snapshot.content) return false;
    if (this.snapshot.content.status === 'archived') return false;
    this.generation += 1;
    this.update({
      draft: copyDraft({ ...this.snapshot.draft, ...patch }),
      dirty: true,
      // A validation rejection did not advance the server version. Editing is an explicit
      // recovery action; conflicts and ambiguous transport failures still require reload.
      ...(this.snapshot.needsReload ? {} : { error: undefined }),
    });
    return true;
  }

  /** Call only on initial load or after explicit consent to discard local edits. */
  public reload(): Promise<Content> {
    return this.enqueue(true, true, async (epoch) => {
      const content = await this.ports.load();
      this.assertCurrent(epoch);
      this.generation += 1;
      this.savedGeneration = this.generation;
      this.update({
        content,
        draft: draftFromContent(content),
        dirty: false,
        error: undefined,
        needsReload: false,
      });
      return content;
    });
  }

  public save(): Promise<Content> {
    return this.enqueue(false, false, (epoch) => this.saveLatest(epoch));
  }

  public createRevision(kind: 'checkpoint' | 'ready', note?: string): Promise<Content> {
    return this.enqueue(true, false, async (epoch) => {
      // Reserve the editing lock synchronously, then wait for any in-flight save.
      const current = await this.saveLatest(epoch);
      this.assertCurrent(epoch);
      const content = await this.ports.revision(kind, {
        contentVersion: current.version,
        draftVersion: current.draft.draftVersion,
        note: note?.trim() || undefined,
      });
      this.acceptCommandResult(content, epoch);
      return content;
    });
  }

  /** The caller must confirm replacement if unsaved local edits exist. */
  public restore(revisionId: string): Promise<Content> {
    return this.enqueue(true, false, async (epoch) => {
      const current = this.requireContent();
      const content = await this.ports.restore(revisionId, current.draft.draftVersion);
      this.assertCurrent(epoch);
      this.generation += 1;
      this.savedGeneration = this.generation;
      this.update({ content, draft: draftFromContent(content), dirty: false });
      return content;
    });
  }

  public archive(): Promise<Content> {
    return this.enqueue(true, false, async (epoch) => {
      const current = await this.saveLatest(epoch);
      this.assertCurrent(epoch);
      const content = await this.ports.archive(current.version);
      this.acceptCommandResult(content, epoch);
      return content;
    });
  }

  private enqueue(
    exclusive: boolean,
    allowError: boolean,
    operation: (epoch: number) => Promise<Content>,
  ): Promise<Content> {
    if (!this.active || (!allowError && this.exclusiveCount > 0)) {
      // Reserve exclusive commands synchronously: two READY clicks in one render
      // must not create two immutable revisions. Cancellation is not a save failure.
      return Promise.reject(new DraftOperationCancelled());
    }
    const epoch = this.epoch;
    const failureSerial = this.failureSerial;
    if (exclusive) {
      this.exclusiveCount += 1;
      this.update({ locked: true });
    }
    const pending = this.tail.then(async () => {
      try {
        this.assertCurrent(epoch);
        if (!allowError) {
          // Cancel every pre-failure intent, even if the user has already corrected
          // the input. Only newly requested commands may use the corrected draft.
          if (failureSerial !== this.failureSerial) throw new DraftOperationCancelled();
          if (this.snapshot.error !== undefined) throw this.snapshot.error;
        }
        try {
          return await operation(epoch);
        } catch (cause) {
          const error = cause ?? new Error('Draft command failed without an error response.');
          if (this.active && epoch === this.epoch) {
            this.failureSerial += 1;
            this.update({
              error,
              needsReload: !this.ports.isValidationError?.(error),
            });
          }
          throw error;
        }
      } finally {
        if (exclusive) {
          this.exclusiveCount -= 1;
          this.update({ locked: this.exclusiveCount > 0 });
        }
      }
    });
    // Keep the queue usable for an explicit reload, but preserve rejection for each caller.
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async saveLatest(epoch: number): Promise<Content> {
    this.assertCurrent(epoch);
    const current = this.requireContent();
    if (current.status === 'archived') throw new Error('Archived content cannot be edited.');
    if (this.generation === this.savedGeneration) return current;
    const generation = this.generation;
    const draft = this.snapshot.draft;
    this.update({ saving: true });
    try {
      const content = await this.ports.save({
        ...draft,
        summary: draft.summary.trim() || undefined,
        draftVersion: current.draft.draftVersion,
      });
      this.assertCurrent(epoch);
      this.savedGeneration = generation;
      // Always advance the server version, even when newer local text must be retained.
      this.update({
        content,
        draft: this.generation === generation ? draftFromContent(content) : this.snapshot.draft,
        dirty: this.generation !== this.savedGeneration,
      });
      return content;
    } finally {
      this.update({ saving: false });
    }
  }

  private acceptCommandResult(content: Content, epoch: number): void {
    this.assertCurrent(epoch);
    this.update({ content, draft: draftFromContent(content), dirty: false });
    this.savedGeneration = this.generation;
  }

  private assertCurrent(epoch: number): void {
    if (!this.active || epoch !== this.epoch) throw new DraftOperationCancelled();
  }

  private requireContent(): Content {
    const content = this.snapshot.content;
    if (!content) throw new Error('Content has not been loaded.');
    return content;
  }

  private update(patch: Partial<DraftSaveSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener();
  }
}

function copyDraft(draft: EditableDraft): Readonly<EditableDraft> {
  return Object.freeze({
    ...draft,
    cover: draft.cover ? Object.freeze({ ...draft.cover }) : null,
  });
}

function draftFromContent(content: Content): Readonly<EditableDraft> {
  return copyDraft({
    title: content.draft.title,
    summary: content.draft.summary ?? '',
    bodyMarkdown: content.draft.bodyMarkdown,
    cover: content.draft.cover,
  });
}
