import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

type Config = {
  hre: HardhatRuntimeEnvironment
};

async function main(config: Config) {
  const { hre } = config;
  const network = hre.network.name;

  console.log(`network: ${network}`);

  const dm = new DeploymentManager(network, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet');

  console.log(`comet: ${comet.address}`);





}

export default main;