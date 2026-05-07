import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal, calldata } from '../../../../src/deploy';

const USDC_COMET = '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991';
const WETH_COMET = '0x60F2058379716A64a7A5d29219397e79bC552194';

const COMET_FACTORY_V2 = '0x3f7149316965258CEBCDA2440c05Fd6ecceC7683';

export default migration('1778158953_update_to_v2_factory', {
  async prepare() {

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
      lineaMessageService,
      governor,
    } = await govDeploymentManager.getContracts();

    const newFactory = await deploymentManager.existing(
      'cometFactoryV2',
      COMET_FACTORY_V2,
      'linea'
    );

    const setConfigurationCalldataUsdc = await calldata(
      configurator.populateTransaction.setFactory(USDC_COMET, newFactory.address)
    );
    const deployAndUpgradeToCalldataUsdc = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET]
    );

    const setConfigurationCalldataWeth = await calldata(
      configurator.populateTransaction.setFactory(WETH_COMET, newFactory.address)
    );
    const deployAndUpgradeToCalldataWeth = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, WETH_COMET]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, cometAdmin.address,
          configurator.address, cometAdmin.address
        ],
        [
          0, 0,
          0, 0
        ],
        [
          'setFactory(address,address)',
          'deployAndUpgradeTo(address,address)',
          'setFactory(address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setConfigurationCalldataUsdc, deployAndUpgradeToCalldataUsdc,
          setConfigurationCalldataWeth, deployAndUpgradeToCalldataWeth
        ]
      ]
    );

    const mainnetActions = [
      // // 1. Update USDC Comet factory to a new one
      // {
      //   contract: configurator,
      //   signature: 'setFactory(address,address)',
      //   args: [USDC_COMET, newFactory.address],
      // },
      // // 2. Deploy and upgrade to a new version of Comet
      // {
      //   contract: cometAdmin,
      //   signature: 'deployAndUpgradeTo(address,address)',
      //   args: [configurator.address, USDC_COMET],
      // },
      // // 3. Update USDT Comet factory to the new one
      // {
      //   contract: configurator,
      //   signature: 'setFactory(address,address)',
      //   args: [USDT_COMET, newFactory.address],
      // },
      // // 4. Deploy and upgrade USDT Comet to a new version of Comet
      // {
      //   contract: cometAdmin,
      //   signature: 'deployAndUpgradeTo(address,address)',
      //   args: [configurator.address, USDT_COMET],
      // },
      // // 5. Update USDS Comet factory to the new one
      // {
      //   contract: configurator,
      //   signature: 'setFactory(address,address)',
      //   args: [USDS_COMET, newFactory.address],
      // },
      // // 6. Deploy and upgrade USDS Comet to a new version of Comet
      // {
      //   contract: cometAdmin,
      //   signature: 'deployAndUpgradeTo(address,address)',
      //   args: [configurator.address, USDS_COMET],
      // },
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Linea.
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [bridgeReceiver.address, 0, l2ProposalData],
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

    const newCometWeth = new Contract(
      WETH_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometWeth.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
  },
});
