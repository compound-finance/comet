import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { CometInterface, Configurator, ProxyAdmin, GovernorSimple } from '../../../build/types';
import { Contract, utils } from 'ethers';
import { deployComet } from '../../../src/deploy';

interface Vars {
  newConfiguratorProxy: string,
};

migration<Vars>('1657918731_upgrade_interest_rate_model', {
  prepare: async (deploymentManager: DeploymentManager) => {
    await deploymentManager.hre.run('compile');

    // Contracts referenced in `configuration.json`.
    const contractOverrides = new Map<string, Contract>([
      ['USDC', await deploymentManager.contract('USDC')],
      ['WBTC.e', await deploymentManager.contract('WBTC.e')],
      ['WAVAX', await deploymentManager.contract('WAVAX')],
    ]);

    // Deploy new Configurator proxy + implementation and CometFactory
    // Note: We deploy a new Configurator proxy to so we can modify the storage layout
    // without having to keep old storage variables and append new variables at the end.
    // This is okay because this is only on testnet.
    const { configuratorProxy } = await deployComet(
      deploymentManager,
      {
        contractsToDeploy: {
          configurator: true,
          configuratorProxy: true,
          cometFactory: true
        },
        contractMapOverride: contractOverrides
      }
    );

    console.log('New Configurator proxy deployed at: ', configuratorProxy.address);

    return {
      newConfiguratorProxy: configuratorProxy.address,
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts: Vars) => {
    const signer = await deploymentManager.getSigner();

    const comet = await deploymentManager.contract('comet') as CometInterface;
    const governor = await deploymentManager.contract('governor') as GovernorSimple;
    const proxyAdmin = await deploymentManager.contract('cometAdmin') as ProxyAdmin;
    const configurator = await deploymentManager.contract('configurator') as Configurator;
    const newConfigurator = configurator.attach(contracts.newConfiguratorProxy);

    // DeployAndUpgradeTo new implementation of Comet:
    // 1. Deploy and upgrade to new implementation of Comet.
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(["address", "address"], [newConfigurator.address, comet.address]);
    const governorAsAdmin = governor.connect(signer);
    let tx = await (await governorAsAdmin.propose(
      [proxyAdmin.address],
      [0],
      ["deployAndUpgradeTo(address,address)"],
      [deployAndUpgradeToCalldata],
      'Upgrade to Comet with new interest rate model')
    ).wait();
    let event = tx.events.find(event => event.event === 'ProposalCreated');
    let [proposalId] = event.args;

    await governorAsAdmin.queue(proposalId);

    console.log(`Created proposal ${proposalId} and queued it. Proposal still needs to be executed.`);

    // Update roots
    const updatedRoots = await deploymentManager.getRoots();
    updatedRoots.set('configurator', newConfigurator.address);
    await deploymentManager.putRoots(updatedRoots);

    // Log out new states to manually verify (helpful to verify via simulation)
    // await governorAsAdmin.execute(proposalId);

    // console.log('New configurator address ', newConfigurator.address);
    // console.log('Getting new configuration for Comet ', comet.address);
    // console.log('New Configuration: ', await newConfigurator.getConfiguration(comet.address));

    // const Comet = await ethers.getContractFactory("Comet");
    // const cometNew = await Comet.attach(comet.address).connect(signer);
    // console.log("Comet supply, borrow kink: ");
    // console.log(await cometNew.supplyKink());
    // console.log(await cometNew.borrowKink());
  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false; // XXX
  },
});
