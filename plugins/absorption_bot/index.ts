import { CometInterface } from '../../build/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

async function main({ hre }) {
  const network = hre.network.name;
  const [absorber] = await hre.ethers.getSigners();

  const dm = new DeploymentManager(network, hre, {
    writeCacheToDisk: false,
    debug: true,
    verifyContracts: true,
  });
  await dm.spider();

  const contracts = await dm.contracts();
  const comet = contracts.get('comet') as CometInterface;

}

export default main;