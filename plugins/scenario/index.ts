import { Constraint, Forker, Initializer, Property, ScenarioFlags } from './Scenario';
import { getLoader } from './Loader';
export { Constraint, Initializer, Property, Scenario, Solution } from './Scenario';
export { ForkSpec, World } from './World';

type ScenarioFn<T> = (name: string, requirements: object, property: Property<T>) => Promise<void>;

interface ScenarioBuilder<T> {
  (name: string, requirements: object, property: Property<T>): void;
  only: (name: string, requirements: object, property: Property<T>) => void;
  skip: (name: string, requirements: object, property: Property<T>) => void;
}

export function addScenario<T>(
  name: string,
  requirements: object,
  property: Property<T>,
  initializer: Initializer<T>,
  forker: Forker<T>,
  constraints: Constraint<T>[],
  flags: ScenarioFlags = null
) {
  getLoader().addScenario(name, requirements, property, initializer, forker, constraints, flags);
}

export function buildScenarioFn<T>(
  initializer: Initializer<T>,
  forker: Forker<T>,
  constraints: Constraint<T>[]
) {
  let addScenarioWithOpts =
    (flags: ScenarioFlags) => (name: string, requirements: object, property: Property<T>) => {
      addScenario<T>(name, requirements, property, initializer, forker, constraints, flags);
    };

  let res: ScenarioBuilder<T> = Object.assign(addScenarioWithOpts(null), {
    only: addScenarioWithOpts('only'),
    skip: addScenarioWithOpts('skip'),
  });

  return res;
}
