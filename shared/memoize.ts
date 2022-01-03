interface MemoizeOptions {
  debug: boolean;
}

export function memoize<T extends any[], U>(
  fn: (...args: T) => U,
  { debug }: MemoizeOptions = { debug: false }
) {
  const cache = {};

  return function (...args: T): U {
    const key = JSON.stringify(args);
    if (key in cache) {
      if (debug) {
        console.log(`Returning from ${fn.name} cache: ${key}`);
      }
      return cache[key];
    } else {
      if (debug) {
        console.log(`Populating ${fn.name} cache for: ${key}`);
      }
      const result = fn.apply(undefined, args);
      cache[key] = result;
      return result;
    }
  };
}

export function memoizeAsync<T extends any[], U>(
  fn: (...args: T) => Promise<U>,
  { debug }: MemoizeOptions = { debug: false }
) {
  const cache = {};

  return async function (...args: T): Promise<U> {
    const key = JSON.stringify(args);
    if (key in cache) {
      if (debug) {
        console.log(`Returning from ${fn.name} cache: ${key}`);
      }
      return cache[key];
    } else {
      if (debug) {
        console.log(`Populating ${fn.name} cache for: ${key}`);
      }
      const result = await fn.apply(undefined, args);
      cache[key] = result;
      return result;
    }
  };
}
