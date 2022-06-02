// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
import hre, { ethers } from 'hardhat';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import {
  Configurator,
  ProxyAdmin,
} from '../build/types';
import { utils } from 'ethers';
import { CometInterface, GovernorSimple } from '../build/types';

/**
 * Creates and queues a proposal that updates some `Comet` configuration and then deploys
 * a new version and upgrades to it.
 *
 * Note: Only to be used on testnets, where proposals can be queued by a single admin.
 */
async function main() {
  await hre.run('compile');
  let isDevelopment = hre.network.name === 'hardhat';
  let dm = new DeploymentManager(hre.network.name, hre, {
    writeCacheToDisk: true,
    verifyContracts: !isDevelopment,
    debug: true,
  });

  const [admin, newPauseGuardian] = await dm.getSigners();

  const governor = await dm.contract('governor') as GovernorSimple;
  const proxyAdmin = await dm.contract('cometAdmin') as ProxyAdmin;
  const comet = await dm.contract('comet') as CometInterface;
  const configurator = await dm.contract('configurator') as Configurator;
  const governorAsAdmin = governor.connect(admin);

  const setPauseGuardianCalldata = ethers.utils.defaultAbiCoder.encode(['address'], [newPauseGuardian.address]);
  const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [configurator.address, comet.address]);
  let tx = await (await governorAsAdmin.propose(
    [
      configurator.address,
      proxyAdmin.address,
    ],
    [
      0,
      0,
    ],
    [
      'setPauseGuardian(address)',
      'deployAndUpgradeTo(address,address)',
    ],
    [
      setPauseGuardianCalldata,
      deployAndUpgradeToCalldata,
    ],
    'Update the Pause Guardian')
  ).wait();
  let event = tx.events.find(event => event.event === 'ProposalCreated');
  let [ proposalId ] = event.args;

  await governorAsAdmin.queue(proposalId);

  console.log(`Created proposal ${proposalId} and queued it. Proposal still needs to be executed.`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
