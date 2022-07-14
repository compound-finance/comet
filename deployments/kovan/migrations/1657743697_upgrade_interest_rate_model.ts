import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { getConfiguration } from '../../../src/deploy/NetworkConfiguration';
import { CometInterface, Configurator, Configurator__factory, CometFactory, CometFactory__factory, ProxyAdmin, GovernorSimple } from '../../../build/types';
import { utils } from 'ethers';
import { extractCalldata } from '../../../src/utils';
import { ConfigurationStruct } from '../../../build/types/Configurator';

interface Vars {
  configurator: string,
  cometFactory: string,
};

migration<Vars>('1657743697_upgrade_interest_rate_model', {
  prepare: async (deploymentManager: DeploymentManager) => {
    await deploymentManager.hre.run('compile');

    // Deploy new Configurator and CometFactory contracts
    const newConfigurator = await deploymentManager.deploy<Configurator, Configurator__factory, []>(
      'Configurator.sol',
      []
    );

    const newCometFactory = await deploymentManager.deploy<CometFactory, CometFactory__factory, []>(
      'CometFactory.sol',
      []
    );

    return {
      configurator: newConfigurator.address,
      cometFactory: newCometFactory.address,
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts: Vars) => {
    let signer = await deploymentManager.getSigner();

    const newConfigurator = contracts.configurator;
    const newCometFactory = contracts.cometFactory;

    const governor = await deploymentManager.contract('governor') as GovernorSimple;
    const proxyAdmin = await deploymentManager.contract('cometAdmin') as ProxyAdmin;
    const configurator = await deploymentManager.contract('configurator') as Configurator;
    const comet = await deploymentManager.contract('comet') as CometInterface;

    const configuration = await getNewConfiguration(configurator, comet, deploymentManager);
    console.log('configuration is ')
    console.log(configuration)

    // Execute a governance proposal to:
    // 1. Upgrade Configurator proxy's implementation to the new Configurator
    // 2. Set the new factory address for Comet in Configurator
    // 3. Set the new Configuration (with new IR model params) for Comet in Configurator
    // 4. Deploy and upgrade to the new implementation of Comet
    const upgradeConfiguratorCalldata = utils.defaultAbiCoder.encode(["address", "address"], [configurator.address, newConfigurator]);
    const setFactoryCalldata = utils.defaultAbiCoder.encode(["address", "address"], [comet.address, newCometFactory]);
    const setConfigurationCalldata = extractCalldata((await configurator.populateTransaction.setConfiguration(comet.address, configuration)).data);
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(["address", "address"], [configurator.address, comet.address]);

    const governorAsAdmin = governor.connect(signer);
    const tx = await (await governorAsAdmin.propose(
      [proxyAdmin.address, configurator.address, configurator.address, proxyAdmin.address],
      [0, 0, 0, 0],
      [
        "upgrade(address,address)",
        "setFactory(address,address)",
        "setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))",
        "deployAndUpgradeTo(address,address)"
      ],
      [
        upgradeConfiguratorCalldata,
        setFactoryCalldata,
        setConfigurationCalldata,
        deployAndUpgradeToCalldata
      ],
      'Upgrade Configurator and Comet to have new interest model'
    )
    ).wait();

    const event = tx.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    await governorAsAdmin.queue(proposalId);

    console.log(`Created proposal ${proposalId} and queued it. Proposal still needs to be executed.`);

    // XXX don't need to spider since proposal is not executed
    console.log("No root.json changes. Re-spidering...");
    await deploymentManager.spider();
  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false; // XXX
  },
});

async function getNewConfiguration(configurator: Configurator, comet: CometInterface, dm: DeploymentManager): Promise<ConfigurationStruct> {
  const onChainConfiguration = await configurator.getConfiguration(comet.address);
  const {
    supplyKink,
    supplyPerYearInterestRateSlopeLow,
    supplyPerYearInterestRateSlopeHigh,
    supplyPerYearInterestRateBase,
    borrowKink,
    borrowPerYearInterestRateSlopeLow,
    borrowPerYearInterestRateSlopeHigh,
    borrowPerYearInterestRateBase,
  } = await getConfiguration(dm.deployment, dm.hre);

  return {
    supplyKink,
    supplyPerYearInterestRateSlopeLow,
    supplyPerYearInterestRateSlopeHigh,
    supplyPerYearInterestRateBase,
    borrowKink,
    borrowPerYearInterestRateSlopeLow,
    borrowPerYearInterestRateSlopeHigh,
    borrowPerYearInterestRateBase,
    ...onChainConfiguration
  }
}
