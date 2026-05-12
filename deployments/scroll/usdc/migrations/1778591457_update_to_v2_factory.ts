import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal, calldata } from '../../../../src/deploy';

const USDC_COMET = '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44';

const COMET_FACTORY_V2 = '0xBE1b3e95c8fE0Cb9B6E825c9F7E1bfbb7855B227';

const USDC_EXT = '0x4DA8f56c46Dc7195FBfF1C775327C13feE7eadAd';

export default migration('1778591457_update_to_v2_factory', {
  async prepare(deploymentManager: DeploymentManager) {

    const cometUSDC = new Contract(
      USDC_COMET,
      ['function extensionDelegate() external view returns (address)'],
      await deploymentManager.getSigner()
    );

    const scrollAssetListFactoryAddress = '0x5404872d8f2e24b230EC9B9eC64E3855F637FB93';

    const extensionDelegateUSDC = new Contract(
      await cometUSDC.extensionDelegate(),
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      await deploymentManager.getSigner()
    );
    const nameUSDC = await extensionDelegateUSDC.name();
    const symbolUSDC = await extensionDelegateUSDC.symbol();

    console.log('USDC constructor args',
      utils.defaultAbiCoder.encode(
        ['tuple(bytes32,bytes32)', 'address'],
        [
          [
            utils.formatBytes32String(nameUSDC),
            utils.formatBytes32String(symbolUSDC)
          ],
          scrollAssetListFactoryAddress
        ]
      )
    );

    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const {
      scrollMessenger,
      governor,
    } = await govDeploymentManager.getContracts();

    const setConfigurationCalldataUsdc = await calldata(
      configurator.populateTransaction.setFactory(USDC_COMET, COMET_FACTORY_V2)
    );
    const setExtensionDelegateCalldataUsdc = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDC_COMET, USDC_EXT)
    );
    const deployAndUpgradeToCalldataUsdc = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, configurator.address, cometAdmin.address,
        ],
        [
          0, 0, 0,
        ],
        [
          'setFactory(address,address)',
          'setExtensionDelegate(address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setConfigurationCalldataUsdc, setExtensionDelegateCalldataUsdc, deployAndUpgradeToCalldataUsdc,
        ]
      ]
    );

    const mainnetActions = [
      // 1. Update USDC Comet to the service patch version
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [bridgeReceiver.address, 0, l2ProposalData, 1_000_000],
        value: exp(0.2, 18)
      },
    ];

    const description = `DESCRIPTION`;
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { configurator } = await deploymentManager.getContracts();

    expect(await configurator.factory(USDC_COMET)).to.equal(COMET_FACTORY_V2);

    expect((await configurator.getConfiguration(USDC_COMET)).extensionDelegate).to.equal(USDC_EXT);

    const expectedMaxUtilization = exp(2, 18);
    const signer = await deploymentManager.getSigner();

    const newCometUsdc = new Contract(
      USDC_COMET, 
      [
        'function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)',
        'function symbol() external view returns (string)',
        'function name() external view returns (string)',
        'function extensionDelegate() external view returns (address)',
      ],
      signer
    );

    expect(await newCometUsdc.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometUsdc.symbol()).to.equal('cUSDCv3');
    expect(await newCometUsdc.name()).to.equal('Compound USDC');
    expect(await newCometUsdc.extensionDelegate()).to.equal(USDC_EXT);
  },
});
