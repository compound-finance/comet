import { expect } from 'chai';
import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const USDC_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';

const COMET_FACTORY_V2 = '0xA41643CAF560a1A38A0Df32b3229C785397557D8';

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
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDC_COMET],
      },
      // 3. Update USDT Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDT_COMET, newFactory.address],
      },
      // 4. Deploy and upgrade USDT Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDT_COMET],
      },
      // 5. Update USDS Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDS_COMET, newFactory.address],
      },
      // 6. Deploy and upgrade USDS Comet to a new version of Comet
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
    const expectedMaxUtilization = exp(2, 18);
    const signer = await deploymentManager.getSigner();

    const newCometUsdc = new Contract(
      USDC_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometUsdc.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);

    const newCometUsdt = new Contract(
      USDT_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometUsdt.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);

    const newCometUsds = new Contract(
      USDS_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometUsds.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
  },
});
