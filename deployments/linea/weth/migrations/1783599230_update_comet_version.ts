import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal, calldata } from '../../../../src/deploy';

const USDC_COMET_LINEA = '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991';
const WETH_COMET_LINEA = '0x60F2058379716A64a7A5d29219397e79bC552194';

export default migration('1783599230_update_comet_version', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver: lineaBridgeReceiver,
      cometAdmin: lineaCometAdmin,
      configurator: lineaConfigurator,
      cometFactory: lineaCometFactory
    } = await deploymentManager.getContracts();

    const {
      lineaMessageService,
      governor,
    } = await govDeploymentManager.getContracts();

    const cometFactoryV2Linea = new Contract(
      lineaCometFactory.address,
      [
        'function setVersion(((uint64,uint64,uint64),string))',
      ],
      await deploymentManager.getSigner()
    );

    const setVersionCalldataLinea = await calldata(
      cometFactoryV2Linea.populateTransaction.setVersion(
        [[1, 2, 1], '']
      )
    );
  
    const deployAndUpgradeToCalldataUsdcLinea = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [lineaConfigurator.address, USDC_COMET_LINEA]
    );
    const deployAndUpgradeToCalldataWethLinea = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [lineaConfigurator.address, WETH_COMET_LINEA]
    );

    const l2ProposalDataLinea = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          lineaCometFactory.address,
          lineaCometAdmin.address,
          lineaCometAdmin.address
        ],
        [
          0,
          0,
          0
        ],
        [
          'setVersion(((uint64,uint64,uint64),string))',
          'deployAndUpgradeTo(address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setVersionCalldataLinea,
          deployAndUpgradeToCalldataUsdcLinea,
          deployAndUpgradeToCalldataWethLinea
        ]
      ]
    );

    const mainnetActions = [
      // 1. Update USDC and WETH Comet on Linea to the service patch version
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [lineaBridgeReceiver.address, 0, l2ProposalDataLinea],
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

  async verify(deploymentManager: DeploymentManager): Promise<void> {
    const {
      cometFactory: lineaCometFactory,
      configurator: lineaConfigurator,
    } = await deploymentManager.getContracts();

    expect(await lineaConfigurator.factory(USDC_COMET_LINEA)).to.equal(lineaCometFactory.address);
    expect(await lineaConfigurator.factory(WETH_COMET_LINEA)).to.equal(lineaCometFactory.address);

    const cometFactoryV2Linea = new Contract(
      lineaCometFactory.address,
      [
        'function version() view returns ((uint64,uint64,uint64),string)',
      ],
      await deploymentManager.getSigner()
    );

    const [version, alternative] = await cometFactoryV2Linea.version();
    expect(version).to.deep.equal([1, 2, 1]);
    expect(alternative).to.equal('');
  },
});
