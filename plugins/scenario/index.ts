import { Property } from './Scenario';
import { getLoader } from './Loader';
export { World } from './Scenario';

export function scenario<T>(name: string, requirements: object, property: Property<T>) {
  getLoader().addScenario(name, requirements, property);
}
