import { expect } from 'chai';
import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const USDC_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';

const COMET_FACTORY_V2 = '0x219E8039359C1ED650c7280bA87251E282288f7F';

const USDC_EXT = '0x048A6eAB0Abeb779fFC837De2c646D130828b005';
const USDT_EXT = '0x2EB48177ac6060924E5E7B55A38365fD48ea799D';
const USDS_EXT = '0x1b21Fb4127f7cC1b643c9d0AcC7BC7e91878ee2c';

export default migration('1777547599_update_usd_based_to_v2_factory', {
  async prepare() {

    return {};
  },

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const newFactory = await deploymentManager.existing(
      'cometFactoryV2',
      COMET_FACTORY_V2,
      'mainnet'
    );

    const mainnetActions = [
      // 1. Update USDC Comet factory to a new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDC_COMET, newFactory.address],
      },
      // 2. Set service patch version of the extension delegate for the USDC Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDC_COMET, USDC_EXT],
      },
      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDC_COMET],
      },
      // 4. Update USDT Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDT_COMET, newFactory.address],
      },
      // 5. Set service patch version of the extension delegate for the USDT Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDT_COMET, USDT_EXT],
      },
      // 6. Deploy and upgrade USDT Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDT_COMET],
      },
      // 7. Update USDS Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDS_COMET, newFactory.address],
      },
      // 8. Set service patch version of the extension delegate for the USDS Comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDS_COMET, USDS_EXT],
      },
      // 9. Deploy and upgrade USDS Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDS_COMET],
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
    expect(await configurator.factory(USDT_COMET)).to.equal(COMET_FACTORY_V2);
    expect(await configurator.factory(USDS_COMET)).to.equal(COMET_FACTORY_V2);

    expect((await configurator.getConfiguration(USDC_COMET)).extensionDelegate).to.equal(USDC_EXT);
    expect((await configurator.getConfiguration(USDT_COMET)).extensionDelegate).to.equal(USDT_EXT);
    expect((await configurator.getConfiguration(USDS_COMET)).extensionDelegate).to.equal(USDS_EXT);

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

    const newCometUsdt = new Contract(
      USDT_COMET,
      [
        'function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)',
        'function symbol() external view returns (string)',
        'function name() external view returns (string)',
        'function extensionDelegate() external view returns (address)',
      ],
      signer
    );

    expect(await newCometUsdt.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometUsdt.symbol()).to.equal('cUSDTv3');
    expect(await newCometUsdt.name()).to.equal('Compound USDT');
    expect(await newCometUsdt.extensionDelegate()).to.equal(USDT_EXT);

    const newCometUsds = new Contract(
      USDS_COMET,
      [
        'function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)',
        'function symbol() external view returns (string)',
        'function name() external view returns (string)',
        'function extensionDelegate() external view returns (address)',
      ],
      signer
    );

    expect(await newCometUsds.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometUsds.symbol()).to.equal('cUSDSv3');
    expect(await newCometUsds.name()).to.equal('Compound USDS');
    expect(await newCometUsds.extensionDelegate()).to.equal(USDS_EXT);
  },
});
