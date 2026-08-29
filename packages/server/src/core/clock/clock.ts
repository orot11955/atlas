export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  private epochMilliseconds: number;

  public constructor(initialValue: Date | string | number) {
    this.epochMilliseconds = parseEpochMilliseconds(initialValue);
  }

  public now(): Date {
    return new Date(this.epochMilliseconds);
  }

  public set(value: Date | string | number): void {
    this.epochMilliseconds = parseEpochMilliseconds(value);
  }

  public advanceBy(milliseconds: number): void {
    if (!Number.isInteger(milliseconds)) {
      throw new RangeError('Clock advance must be an integer number of milliseconds.');
    }

    this.epochMilliseconds += milliseconds;
  }
}

export const systemClock = new SystemClock();

function parseEpochMilliseconds(value: Date | string | number): number {
  const milliseconds =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? new Date(value).getTime()
        : value;

  if (!Number.isFinite(milliseconds)) {
    throw new RangeError('Clock value must represent a valid date.');
  }

  return milliseconds;
}
