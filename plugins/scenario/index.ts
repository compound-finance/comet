import { Forker, Initializer, Property } from './Scenario';
import { getLoader } from './Loader';
export { Initializer, Property, World } from './Scenario';
export { ForkSpec } from './Runner';

export function addScenario<T>(name: string, requirements: object, property: Property<T>, initializer: Initializer<T>, forker: Forker<T>) {
  getLoader().addScenario(name, requirements, property, initializer, forker);
}
