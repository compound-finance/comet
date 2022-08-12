
export interface StackCall {
  function?: string;
  file?: string;
  line?: number;
  char?: number;
}

export function getStack(skipFrames: number = 1): StackCall[] {
  const regex = /at (?<function>[^ ]+) [(](?<file>[^ ]+?)(:(?<line>\d+))?(:(?<char>\d+))?[)]/g;
  const stack = new Error().stack;
  let next;
  const trace = [];
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
