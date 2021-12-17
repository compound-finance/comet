import { getLoader } from './Loader';
import { Context, Property } from './Scenario';
export { Context, ContextCreator, World, Scenario, Constraint, Solution } from './Scenario';

export function scenario<T extends Context>(name: string, requirements: object, property: Property<T>) {
  getLoader().addScenario(name, requirements, property);
}
