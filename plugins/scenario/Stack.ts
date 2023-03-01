
export interface StackCall {
  function?: string;
  file?: string;
  line?: number;
  char?: number;
}

export function getStack(skipFrames: number = 1): StackCall[] {
  let regex = /at (?<function>[^ ]+) [(](?<file>[^ ]+?)(:(?<line>\d+))?(:(?<char>\d+))?[)]/g;
  let stack = new Error().stack;
  let next;
  let trace = [];
  let index = 0;

  while (null != (next=regex.exec(stack))) {
    if (++index > skipFrames) {
      trace.push({
        function: next.groups['function'],
        file: next.groups['file'],
        line: next.groups['line'] ? Number(next.groups['line']) : undefined,
        char: next.groups['char'] ? Number(next.groups['char']) : undefined,
      });
    }
  }

  return trace;
}

export function getStackFile(): string | null {
  return getStack(3)[0]?.file ?? null;
}
