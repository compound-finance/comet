import { ForkSpec, Property, World, buildScenarioFn } from '../plugins/scenario';
import { ContractMap, getEthersContractsForDeployment } from '../plugins/spider';

export class CometContext {
  dog: string;
  contracts: ContractMap;

  constructor(dog: string, contracts: ContractMap) {
    this.dog = dog;
    this.contracts = contracts;
  }

  async btcBalance(address: string): Promise<number> {
    return await this.contracts.WBTC.balanceOf(address) / 1e8;
  }
}

const getInitialContext = async (world: World, base: ForkSpec): Promise<CometContext> => {
  const contracts = await getEthersContractsForDeployment(world.hre, base.name);
  return new CometContext("spot", contracts);
}

async function forkContext(c: CometContext): Promise<CometContext> {
  return c;
}

export const scenario = buildScenarioFn(getInitialContext, forkContext);
