import { exp, proposal } from '../../../../src/deploy';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

interface Vars {
  deployedContracts: any;
};

const governorTimelockAddress = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';
const marketUpdateMultiSig = '0x7053e25f7076F4986D632A3C04313C81831e0d55';
const marketUpdateProposalGuardian =
  '0x77B65c68E52C31eb844fb3b4864B91133e2C1308';
const delay = 360000;


export default migration('1728316375_gov_marketupdates', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const ethers = deploymentManager.hre.ethers;

    const marketUpdateTimelock = await deploymentManager.deploy(
      'marketUpdateTimelock',
      'marketupdates/MarketUpdateTimelock.sol',
      [governorTimelockAddress, delay],
      true
    );

    const marketUpdateProposer = await deploymentManager.deploy(
      'marketUpdateProposer',
      'marketupdates/MarketUpdateProposer.sol',
      [
        governorTimelockAddress,
        marketUpdateMultiSig,
        marketUpdateProposalGuardian,
        marketUpdateTimelock.address,
      ],
      true
    );

    const configurator = await deploymentManager.deploy(
      'configuratorNew',
      'Configurator.sol',
      [],
      true
    );

    const cometProxyAdmin = await deploymentManager.deploy(
      'cometProxyAdminNew',
      'CometProxyAdmin.sol',
      [governorTimelockAddress],
      true
    );

    const marketAdminPermissionChecker = await deploymentManager.deploy(
      'marketAdminPermissionChecker',
      'marketupdates/MarketAdminPermissionChecker.sol',
      [
        governorTimelockAddress,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
      ]
    );
    const deployedContracts = {
      marketUpdateTimelock,
      marketUpdateProposer,
      configurator,
      cometProxyAdmin,
      marketAdminPermissionChecker,
    };

    return { deployedContracts };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    vars: Vars
  ) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    // Assuming that we have the addresses of the contracts we need to interact with
    const addresses: any = {};

    const { bridgeReceiver, comet, cometAdmin, configurator, rewards } =
      await deploymentManager.getContracts();

    const { scrollMessenger, scrollL1USDCGateway, governor, USDC } =
      await govDeploymentManager.getContracts();

    const cometProxyAdminOldAddress = addresses.cometProxyAdminAddress;
    const configuratorProxyAddress = addresses.configuratorProxyAddress;
    const configuratorNewAddress = addresses.configuratorImplementationAddress;
    const cometProxyAdminNewAddress = addresses.newCometProxyAdminAddress;
    const marketAdminPermissionCheckerAddress =
      addresses.marketAdminPermissionCheckerAddress;
    const marketUpdateTimelockAddress = addresses.marketUpdateTimelockAddress;
    const marketUpdateProposerAddress = addresses.marketAdminProposerAddress;
    const cometProxyAddress = addresses.markets[0].cometProxyAddress;

    const changeProxyAdminForCometProxyCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [cometProxyAddress, cometProxyAdminNewAddress]
    );

    const changeProxyAdminForConfiguratorProxyCalldata =
      utils.defaultAbiCoder.encode(
        ['address', 'address'],
        [configuratorProxyAddress, cometProxyAdminNewAddress]
      );

    const upgradeConfiguratorProxyCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configuratorProxyAddress, configuratorNewAddress]
    );

    const setMarketAdminCalldata = utils.defaultAbiCoder.encode(
      ['address'],
      [marketUpdateTimelockAddress]
    );

    const setMarketAdminPermissionCheckerForConfiguratorProxyCalldata =
      utils.defaultAbiCoder.encode(
        ['address'],
        [marketAdminPermissionCheckerAddress]
      );

    const setMarketAdminPermissionCheckerForCometProxyCalldata =
      utils.defaultAbiCoder.encode(
        ['address'],
        [marketAdminPermissionCheckerAddress]
      );

    const setMarketUpdateProposerCalldata = utils.defaultAbiCoder.encode(
      ['address'],
      [marketUpdateProposerAddress]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          cometProxyAdminOldAddress,
          cometProxyAdminOldAddress,
          cometProxyAdminNewAddress,
          marketAdminPermissionCheckerAddress,
          configuratorProxyAddress,
          cometProxyAdminNewAddress,
          marketUpdateTimelockAddress,
        ],
        [0, 0, 0, 0, 0, 0, 0],
        [
          'changeProxyAdmin(address,address)',
          'changeProxyAdmin(address,address)',
          'upgrade(address,address)',
          'setMarketAdmin(address)',
          'setMarketAdminPermissionChecker(address)',
          'setMarketAdminPermissionChecker(address)',
          'setMarketUpdateProposer(address)',
        ],
        [
          changeProxyAdminForCometProxyCalldata,
          changeProxyAdminForConfiguratorProxyCalldata,
          upgradeConfiguratorProxyCalldata,
          setMarketAdminCalldata,
          setMarketAdminPermissionCheckerForConfiguratorProxyCalldata,
          setMarketAdminPermissionCheckerForCometProxyCalldata,
          setMarketUpdateProposerCalldata,
        ],
      ]
    );

    const actions = [
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [bridgeReceiver.address, 0, l2ProposalData, 600_000],
        value: exp(0.1, 18),
      },
    ];

    const description =
      'Governance proposal with actions to change proxy admins, upgrade the configurator, and set the market admin and related roles.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find((event) => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  }
});
