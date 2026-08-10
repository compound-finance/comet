import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal, calldata } from '../../../../src/deploy';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';

const USDC_COMET_LINEA = '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991';
const WETH_COMET_LINEA = '0x60F2058379716A64a7A5d29219397e79bC552194';

////

const USDC_COMET_SCROLL = '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44';

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
      scrollMessenger,
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

    // Scroll    
    const scrollHre = await forkedHreForBase({ name: 'scroll-usdc', network: 'scroll', deployment: 'usdc' });
    const scrollDm = await govDeploymentManager.addBridgedDeploymentManager('scroll', 'usdc', scrollHre);
    const {
      bridgeReceiver: scrollBridgeReceiver,
      configurator: scrollConfigurator,
      cometFactory: scrollCometFactory,
      cometAdmin: scrollCometAdmin,
    } = await scrollDm.getContracts();

    const cometFactoryV2Scroll = new Contract(
      scrollCometFactory.address,
      [
        'function setVersion(((uint64,uint64,uint64),string))',
      ],
      await scrollDm.getSigner()
    );

    const setVersionCalldataScroll = await calldata(
      cometFactoryV2Scroll.populateTransaction.setVersion(
        [[1, 2, 1], '']
      )
    );

    const deployAndUpgradeToCalldataUsdcScroll = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [scrollConfigurator.address, USDC_COMET_SCROLL]
    );

    const l2ProposalDataScroll = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          scrollCometFactory.address, scrollCometAdmin.address,
        ],
        [
          0, 0,
        ],
        [
          'setVersion(((uint64,uint64,uint64),string))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setVersionCalldataScroll, deployAndUpgradeToCalldataUsdcScroll,
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
      // 2. Update USDC Comet to the service patch version
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [scrollBridgeReceiver.address, 0, l2ProposalDataScroll, 1_000_000],
        value: exp(0.05, 18)
      },
    ];

    const description = `# Update Comet version on Linea and Scroll

## Proposal summary

This proposal upgrades the Compound III USDC and WETH markets on Linea and the USDC market on Scroll to a new Comet version that changes how the base supply index is capped in markets that have lenders but no borrowers.

Previously, \`accruedInterestIndices()\` applied a post-accrual clamp: whenever \`totalBorrowBase == 0\`, if \`presentValueSupply(totalSupplyBase)\` exceeded the Comet's base token balance, \`baseSupplyIndex\` was forced down to \`(balance * BASE_INDEX_SCALE) / totalSupplyBase\`. This protected lender withdrawals in reserve-funded markets with no borrowers, but only corrected the index after it had already been pushed too far.

The new version enforces the same cap earlier, in \`getSupplyRate()\`: when utilization is \`0\` and \`presentValueSupply(totalSupplyBase) >= balanceOf(this)\`, the supply rate returns \`0\`, so accrual stops before the index overshoots rather than being corrected after the fact. Because a single accrual step still applies one rate over the full \`timeElapsed\`, a long gap between accruals can still overshoot the cap by a few wei; after that, \`getSupplyRate()\` returns \`0\` and the supply index no longer increases.

Further detailed information can be found in the corresponding [pull request](https://github.com/compound-finance/comet/pull/1139).

## Audit

The new Comet version has been audited by [Certora](https://certora.cdn.prismic.io/certora/o_tSg8jfh3YhErQ7_Woof-CometPRs-FinalReport.pdf) and no issues were found.

## Proposal Actions

The first action updates the Comet implementation version in V2 Factory on Linea and deploys and upgrades the USDC and WETH Comets to the new implementation.

The second action updates the Comet implementation version in V2 Factory on Scroll and deploys and upgrades the USDC Comet to the new implementation.`;

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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager): Promise<void> {
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

    // Scroll
    const scrollDm = govDeploymentManager.bridgedDeploymentManagers.get('scroll:usdc') as DeploymentManager;
    const {
      configurator: scrollConfigurator,
      cometFactory: scrollCometFactory,
    } = await scrollDm.getContracts();

    expect(await scrollConfigurator.factory(USDC_COMET_SCROLL)).to.equal(scrollCometFactory.address);
    const scrollSigner = await scrollDm.getSigner();
    
    const cometFactoryV2Scroll = new Contract(
      scrollCometFactory.address,
      [
        'function version() view returns ((uint64,uint64,uint64),string)',
      ],
      scrollSigner
    );

    const [versionScroll, alternativeScroll] = await cometFactoryV2Scroll.version();
    expect(versionScroll).to.deep.equal([1, 2, 1]);
    expect(alternativeScroll).to.equal('');
  },
});
