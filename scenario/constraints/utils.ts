
export function requireString(o: object, key: string, err: string): string {
  let value: unknown = o[key];
  if (value === undefined) {
    throw new Error(err);
  }
  if (typeof value !== 'string') {
    throw new Error(`${err} [requirement ${key} required to be string type]`);
  }
  return value;
}

export function requireList<T>(o: object, key: string, err: string): T[] {
  let value: unknown = o[key];
  if (value === undefined) {
    throw new Error(err);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${err} [requirement ${key} required to be list type]`);
  }
  return value as T[];
}

export function requireNumber<T>(o: object, key: string, err: string): number {
  let value: unknown = o[key];
  if (value === undefined) {
    throw new Error(err);
  }
  if (typeof value !== 'number') {
    throw new Error(`${err} [requirement ${key} required to be number type]`);
  }
  return value;  
}

export function optionalNumber<T>(o: object, key: string): number {
  let value: unknown = o[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    throw new Error(`[requirement ${key} required to be number type]`);
  }
  return value;  
}
