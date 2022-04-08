import { ethers } from 'hardhat';
import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { CometInterface, ProxyAdmin, Configurator, SimpleTimelock, SimpleTimelock__factory, GovernorSimple, GovernorSimple__factory } from '../../../build/types';

interface Vars {
  timelock: SimpleTimelock,
  governor: GovernorSimple,
};

// XXX create a scenario for this migration when MigrationConstraint is ready
migration<Vars>('1649108513_upgrade_timelock_and_set_up_governor', {
  // Prepared via Github Actions run: https://github.com/compound-finance/comet/actions/runs/2093081942
  prepare: async (deploymentManager: DeploymentManager) => {
    await deploymentManager.hre.run('compile');

    let [signer] = await deploymentManager.hre.ethers.getSigners();

    // Deploy new Timelock and Governor contracts
    const newGovernor = await deploymentManager.deploy<GovernorSimple, GovernorSimple__factory, []>(
      'test/GovernorSimple.sol',
      []
    );

    const newTimelock = await deploymentManager.deploy<SimpleTimelock, SimpleTimelock__factory, [string]>(
      'test/SimpleTimelock.sol',
      [newGovernor.address]
    );

    // Initialize the storage of GovernorSimple. This sets `signer` as the only admin right now.
    await newGovernor.initialize(newTimelock.address, [signer.address]);

    return {
      timelock: newTimelock,
      governor: newGovernor
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts: Vars) => {
    let [signer] = await deploymentManager.hre.ethers.getSigners();

    const newTimelock = contracts.timelock;
    const newGovernor = contracts.governor;

    const oldGovernor = await deploymentManager.contract('governor') as GovernorSimple;
    const proxyAdmin = await deploymentManager.contract('cometAdmin') as ProxyAdmin;
    const configurator = await deploymentManager.contract('configurator') as Configurator;
    const comet = await deploymentManager.contract('comet') as CometInterface;

    // Set new Timelock as the new admin for ProxyAdmin and the new governor for Configurator and Comet:
    // 1. Set governor as new Timelock in configurator.
    // 2. Deploy and upgrade to new version of Comet.
    // 3. Set owner of ProxyAdmin to be the new Timelock.
    // 4. Set admin of Configurator to be the new Timelock.
    const transferProxyAdminOwnership = ethers.utils.defaultAbiCoder.encode(["address"], [newTimelock.address]);
    const transferConfiguratorAdminCalldata = ethers.utils.defaultAbiCoder.encode(["address"], [newTimelock.address]);
    const setGovernorCalldata = ethers.utils.defaultAbiCoder.encode(["address"], [newTimelock.address]);
    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(["address", "address"], [configurator.address, comet.address]);
    const oldGovernorAsAdmin = oldGovernor.connect(signer);

    // Create a new proposal and queue it up. Execution can be done manually or in a third step.
    let tx = await (await oldGovernorAsAdmin.propose(
      [
        configurator.address,
        proxyAdmin.address,
        proxyAdmin.address,
        configurator.address,
      ],
      [0, 0, 0, 0],
      [
        "setGovernor(address)",
        "deployAndUpgradeTo(address,address)",
        "transferOwnership(address)",
        "transferAdmin(address)",
      ],
      [
        setGovernorCalldata,
        deployAndUpgradeToCalldata,
        transferProxyAdminOwnership,
        transferConfiguratorAdminCalldata,
      ],
      'Upgrade Timelock and Governor')
    ).wait();
    let event = tx.events.find(event => event.event === 'ProposalCreated');
    let [ proposalId ] = event.args;

    await oldGovernorAsAdmin.queue(proposalId);

    console.log(`Created proposal ${proposalId} and queued it. Proposal still needs to be executed.`);

    console.log(`Executing proposal ${proposalId}...`);
    await oldGovernorAsAdmin.execute(proposalId);
    console.log(`Executed proposal ${proposalId}`);

    // XXX create a third step that actually executes the proposal on testnet and logs the results
    // Log out new states to manually verify (helpful to verify via simulation)
    // console.log("Old Timelock: ", oldTimelock.address);
    // console.log("New Timelock: ", newTimelock.address);
    // console.log("Governor: ", newGovernor.address);
    // console.log("Governor's Admin: ", await newGovernor.admins(0));
    // console.log("Governor's Timelock: ", await newGovernor.timelock());
    // console.log("Timelock's Admin: ", await newTimelock.admin());
    // console.log("ProxyAdmin's Admin: ", await proxyAdmin.owner());
    // console.log("Configurator's Admin: ", await configurator.callStatic.admin());
    // console.log("Comet's Admin: ", await comet.governor());
  },
});
