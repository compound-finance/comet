import { Forker, Initializer, Property, ScenarioFlags } from './Scenario';
import { getLoader } from './Loader';
export { Initializer, Property, World } from './Scenario';
export { ForkSpec } from './Runner';

type ScenarioFn<T> =  (name: string, requirements: object, property: Property<T>) => Promise<void>;

interface ScenarioBuilder<T> {
  (name: string, requirements: object, property: Property<T>): void;
  only: (name: string, requirements: object, property: Property<T>) => void,
  skip: (name: string, requirements: object, property: Property<T>) => void
}

export function addScenario<T>(name: string, requirements: object, property: Property<T>, initializer: Initializer<T>, forker: Forker<T>, flags: ScenarioFlags = null) {
  getLoader().addScenario(name, requirements, property, initializer, forker, flags);
}

export function buildScenarioFn<T>(initializer: Initializer<T>, forker: Forker<T>) {
  let addScenarioWithOpts = (flags: ScenarioFlags) => (name: string, requirements: object, property: Property<T>) => {
    addScenario<T>(name, requirements, property, initializer, forker, flags);
  };

  let res: ScenarioBuilder<T> = Object.assign(
    addScenarioWithOpts(null),
    {
      only: addScenarioWithOpts("only"),
      skip: addScenarioWithOpts("skip"),
    });

  return res;
}
