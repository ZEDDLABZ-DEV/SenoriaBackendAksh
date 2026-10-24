export interface Clock {
  now(): Date;
}

const systemClock: Clock = {
  now: () => new Date(),
};

let current: Clock = systemClock;

export function now(): Date {
  return current.now();
}

export function setClock(clock: Clock): void {
  current = clock;
}

export function resetClock(): void {
  current = systemClock;
}
