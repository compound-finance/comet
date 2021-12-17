import { ForkSpec, Property, World, addScenario } from '../plugins/scenario';
import { ContractMap, getEthersContractsForDeployment } from '../plugins/spider';

export class CometContext {
  dog: string;
  contracts: ContractMap;

  constructor(dog: string, contracts: ContractMap) {
    this.dog = dog;
    this.contracts = contracts;
  }
}

const getInitialContext = async (world: World, base: ForkSpec): Promise<CometContext> => {
  const contracts = await getEthersContractsForDeployment(world.hre, base.name);
  return new CometContext("spot", contracts);
}

async function forkContext(c: CometContext): Promise<CometContext> {
  return {...c};
}

export function scenario(name: string, requirements: object, property: Property<CometContext>) {
  addScenario<CometContext>(name, requirements, property, getInitialContext, forkContext);
}
