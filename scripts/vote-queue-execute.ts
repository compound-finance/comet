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
  const PROPOSAL_ID = requireEnv('PROPOSAL_ID');
  const network = hre.network.name;
  const networkBase = config.scenario.bases.find(b => b.network === network);
  const deployment = networkBase.deployment; // just for gov

  const dm = new DeploymentManager(
    network,
    deployment,
    hre,
    {
      writeCacheToDisk: true,
    }
  );
  await dm.spider();

  const trace = dm.tracer();
  const governor = await dm.contract('governor');
  console.log(`Governor via ${network}/${deployment}: ${governor?.address ?? 'NO GOVERNOR FOUND!'}`);

  const { startBlock, endBlock, eta } = await governor.proposals(PROPOSAL_ID);

  await until(async () => {
    const blockNow = await hre.ethers.provider.getBlockNumber();
    console.log(`Current block is: ${blockNow} (starts: ${startBlock})`);
    return blockNow > startBlock;
  });

  console.log(`Attempting to vote in favor of proposal ${PROPOSAL_ID}`);
  trace(await governor.castVote(PROPOSAL_ID, 1));

  await until(async () => {
    const state = await governor.state(PROPOSAL_ID);
    const blockNum = await hre.ethers.provider.getBlockNumber();
    console.log(`Current proposal state is: ${ProposalState[state]} at ${blockNum} (ends: ${endBlock})`);
    return state == ProposalState.Succeeded;
  });

  console.log(`Attempting to queue proposal ${PROPOSAL_ID}`);
  trace(await governor.queue(PROPOSAL_ID));

  await until(async () => {
    const block = await hre.ethers.provider.getBlock('latest');
    console.log(`Current block time is: ${block.timestamp} (eta: ${eta})`);
    return block.timestamp > eta;
  });

  console.log(`Attempting to execute proposal ${PROPOSAL_ID}`);
  trace(await governor.execute(PROPOSAL_ID));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
