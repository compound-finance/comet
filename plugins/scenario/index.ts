import { Constraint, Forker, Initializer, Property, ScenarioFlags, Transformer } from './Scenario';
import { getLoader } from './Loader';
export { Constraint, Initializer, Property, Scenario, Solution, Transformer } from './Scenario';
export { ForkSpec, World } from './World';

type ScenarioFn<T, U> = (
  name: string,
  requirements: object,
  property: Property<T, U>
) => Promise<void>;

interface ScenarioBuilder<T, U, R> {
  (name: string, requirements: R, property: Property<T, U>): void;
  only: (name: string, requirements: R, property: Property<T, U>) => void;
  skip: (name: string, requirements: R, property: Property<T, U>) => void;
}

export function addScenario<T, U, R>(
  name: string,
  requirements: R,
  property: Property<T, U>,
  initializer: Initializer<T>,
  transformer: Transformer<T, U>,
  forker: Forker<T>,
  constraints: Constraint<T, R>[],
  flags: ScenarioFlags = null
) {
  getLoader().addScenario(
    name,
    requirements,
    property,
    initializer,
    transformer,
    forker,
    constraints,
    flags
  );
}

export function buildScenarioFn<T, U, R>(
  initializer: Initializer<T>,
  transformer: Transformer<T, U>,
  forker: Forker<T>,
  constraints: Constraint<T, R>[]
) {
  let addScenarioWithOpts =
    (flags: ScenarioFlags) => (name: string, requirements: R, property: Property<T, U>) => {
      addScenario<T, U, R>(
        name,
        requirements,
        property,
        initializer,
        transformer,
        forker,
        constraints,
        flags
      );
    };

  let res: ScenarioBuilder<T, U, R> = Object.assign(addScenarioWithOpts(null), {
    only: addScenarioWithOpts('only'),
    skip: addScenarioWithOpts('skip'),
  });

  return res;
}
