// mode-token.js — tiny generation leases for cancelling stale async renderer work.
// Begin every move/turn with begin(); call enter(mode) on mode switches; check isCurrent()
// immediately after every await before reading or mutating shared renderer state.
// Keep this module dependency-free and byte-identical across games after cross-review.

const MODE = /^[a-z][a-z0-9.-]{0,31}$/;

function assertMode(value) {
  if (typeof value !== 'string' || !MODE.test(value)) {
    throw new TypeError('mode token requires a short lowercase mode');
  }
  return value;
}

export function createModeToken(initialMode = 'live') {
  let mode = assertMode(initialMode);
  let generation = 0;

  const issue = (nextMode) => {
    if (generation >= Number.MAX_SAFE_INTEGER) throw new RangeError('mode token generation exhausted');
    mode = assertMode(nextMode);
    generation += 1;
    return Object.freeze({ generation, mode });
  };
  const capture = () => Object.freeze({ generation, mode });
  const isCurrent = (token, expectedMode = token?.mode) => !!token
    && Number.isSafeInteger(token.generation)
    && token.generation === generation
    && expectedMode === mode
    && token.mode === mode;

  return Object.freeze({
    // Start a new async operation in the current mode, invalidating older work.
    begin: () => issue(mode),
    // Change renderer mode and invalidate every in-flight operation.
    enter: (nextMode) => issue(nextMode),
    // Invalidate work without changing mode.
    cancel: () => issue(mode),
    // Observe the current lease without invalidating anything.
    capture,
    isCurrent,
    get mode() { return mode; },
    get generation() { return generation; },
  });
}

