import hre from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { ProposalState } from '../scenario/context/Gov';
import { default as config, requireEnv } from '../hardhat.config';

async function until(fn: () => Promise<boolean>, interval = 6000) {
  while (!await fn()) {
    await new Promise(ok => setTimeout(ok, interval));
  }
}

async function main() {
  const network = hre.network.name;

  const dm = new DeploymentManager(
    network,
    'weth',
    hre,
    {
      writeCacheToDisk: true,
    }
  );
  await dm.spider();

  const trace = dm.tracer();
  const comet = await dm.contract('comet');

  console.log(await comet.totalsBasic());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
