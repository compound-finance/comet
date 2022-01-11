import { World } from './World';

// A solution modifies a given context and world in a way that satisfies a constraint.
export type Solution<T> = (T, World) => Promise<T | void>;

// A constraint is capable of producing solutions for a context and world *like* the ones provided.
// A constraint can also check a given context and world to see if they *actually* satisfy it.
// Note: `solve` and `check` are expected to treat the context and world as immutable.
export interface Constraint<T> {
  solve(
    requirements: object,
    context: T,
    world: World
  ): Promise<Solution<T> | Solution<T>[] | null>;
  check(requirements: object, context: T, world: World): Promise<void>;
}

export type Property<T> = (context: T, world: World) => Promise<any>;
export type Initializer<T> = (world: World) => Promise<T>;
export type Forker<T> = (T) => Promise<T>;

export type ScenarioFlags = null | 'only' | 'skip';

interface StackCall {
  function?: string,
  file?: string,
  line?: number,
  char?: number,
}

function getStack(skipFrames: number = 1): StackCall[] {
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

export class Scenario<T> {
  name: string;
  file: string | null;
  requirements: object;
  property: Property<T>;
  initializer: Initializer<T>;
  forker: Forker<T>;
  constraints: Constraint<T>[];
  flags: ScenarioFlags;

  constructor(name, requirements, property, initializer, forker, constraints, flags) {
    this.name = name;
    this.requirements = requirements;
    this.property = property;
    this.initializer = initializer;
    this.forker = forker;
    this.constraints = constraints;
    this.flags = flags;
    let frame = getStack(3);
    this.file = frame[0] ? frame[0].file : null;
  }
}
