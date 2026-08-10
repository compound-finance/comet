import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal, calldata } from '../../../../src/deploy';

const USDC_COMET_SCROLL = '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44';

export default migration('1783599218_update_comet_version', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      cometAdmin,
      configurator,
      cometFactory
    } = await deploymentManager.getContracts();

    const {
      scrollMessenger,
      governor,
    } = await govDeploymentManager.getContracts();

    const cometFactoryV2Scroll = new Contract(
      cometFactory.address,
      [
        'function setVersion(((uint64,uint64,uint64),string))',
      ],
      await deploymentManager.getSigner()
    );

    const setVersionCalldataUsdc = await calldata(
      cometFactoryV2Scroll.populateTransaction.setVersion(
        [[1, 2, 1], '']
      )
    );
    const deployAndUpgradeToCalldataUsdc = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET_SCROLL]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          cometFactory.address, cometAdmin.address,
        ],
        [
          0, 0,
        ],
        [
          'setVersion(((uint64,uint64,uint64),string))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setVersionCalldataUsdc, deployAndUpgradeToCalldataUsdc,
        ]
      ]
    );

    const mainnetActions = [
      // 1. Update USDC Comet to the service patch version
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [bridgeReceiver.address, 0, l2ProposalData, 1_000_000],
        value: exp(0.05, 18)
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
    const { cometFactory } = await deploymentManager.getContracts();
    const signer = await deploymentManager.getSigner();

    const cometFactoryV2Scroll = new Contract(
      cometFactory.address,
      [
        'function version() view returns ((uint64,uint64,uint64),string)',
      ],
      signer
    );

    const [version, alternative] = await cometFactoryV2Scroll.version();
    expect(version).to.deep.equal([1, 2, 1]);
    expect(alternative).to.equal('');
  },
});
