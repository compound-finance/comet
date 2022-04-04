import { ethers } from 'hardhat';
import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { CometInterface, ProxyAdmin, Configurator, OldTimelockInterface, SimpleTimelock, SimpleTimelock__factory, GovernorSimple, GovernorSimple__factory } from '../../../build/types';
import { fastGovernanceExecute } from '../../../scenario/utils';

interface Vars {
  timelock: string,
  governor: string,
};

// XXX create a scenario for this migration when MigrationConstraint is ready
migration<Vars>('1649108513_upgrade_timelock_and_set_up_governor', {
  prepare: async (deploymentManager: DeploymentManager) => {
    let [signer] = await deploymentManager.hre.ethers.getSigners();

    // Deploy new Timelock and Governor contracts
    const governor = await deploymentManager.deploy<GovernorSimple, GovernorSimple__factory, []>(
      'test/GovernorSimple.sol',
      []
    );
  
    const newTimelock = await deploymentManager.deploy<SimpleTimelock, SimpleTimelock__factory, [string]>(
      'test/SimpleTimelock.sol',
      [governor.address]
    );

    // Initialize the storage of GovernorSimple. This sets `signer` as the only admin right now.
    await governor.initialize(newTimelock.address, [signer.address]);

    // Set new Timelock as the new admin for ProxyAdmin and the new governor for Configurator and Comet:
    // 1. Set admin of ProxyAdmin to be the new Timelock. Old Timelock needs to call ProxyAdmin.transferOwnership
    // 2. Set admin of Configurator to be the new Timelock. Old Timelock needs to call Configurator.transferAdmin
    // 3. Set governor as new Timelock in configurator and upgrade Comet. New Timelock needs to call via governance proposal

    const oldTimelock = await deploymentManager.contract('timelock') as OldTimelockInterface;
    const proxyAdmin = await deploymentManager.contract('cometAdmin') as ProxyAdmin;
    const configurator = await deploymentManager.contract('configurator') as Configurator;
    const comet = await deploymentManager.contract('comet') as CometInterface;

    // 1. Set admin of ProxyAdmin to be the new Timelock. Old Timelock needs to call ProxyAdmin.transferOwnership
    const transferOwnershipCalldata = ethers.utils.defaultAbiCoder.encode(["address"], [newTimelock.address]);
    await oldTimelock.execute(
      [proxyAdmin.address], 
      [0], 
      ["transferOwnership(address)"], 
      [transferOwnershipCalldata]
    );

    // 2. Set admin of Configurator to be the new Timelock. Old Timelock needs to call Configurator.transferAdmin
    const transferAdminCalldata = ethers.utils.defaultAbiCoder.encode(["address"], [newTimelock.address]);
    await oldTimelock.execute(
      [configurator.address], 
      [0], 
      ["transferAdmin(address)"], 
      [transferAdminCalldata]
    );

    // 3. Set governor as new Timelock in configurator and upgrade Comet. New Timelock needs to call via governance proposal
    const setGovernorCalldata = ethers.utils.defaultAbiCoder.encode(["address"], [newTimelock.address]);
    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(["address", "address"], [configurator.address, comet.address]);
    const governorAsAdmin = governor.connect(signer);
    await fastGovernanceExecute(
      governorAsAdmin,
      [configurator.address, proxyAdmin.address], 
      [0, 0], 
      ["setGovernor(address)", "deployAndUpgradeTo(address,address)"], 
      [setGovernorCalldata, deployAndUpgradeToCalldata]
    );

    // Log out new states to manually verify (helpful to verify during simulation)
    console.log("Old Timelock: ", oldTimelock.address);
    console.log("New Timelock: ", newTimelock.address);
    console.log("Governor: ", governor.address);
    console.log("Governor's Admin: ", await governor.admins(0));
    console.log("Governor's Timelock: ", await governor.timelock());
    console.log("Timelock's Admin: ", await newTimelock.admin());
    console.log("ProxyAdmin's Admin: ", await proxyAdmin.owner());
    console.log("Configurator's Admin: ", await configurator.callStatic.admin());
    console.log("Comet's Admin: ", await comet.governor());

    return {
      timelock: newTimelock.address,
      governor: governor.address
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts: Vars) => {
    console.log("You should set roots.json to:");
    console.log("");
    console.log("");
    console.log(JSON.stringify(contracts, null, 4));
    console.log("");
  },
});
