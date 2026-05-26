import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal, calldata } from '../../../../src/deploy';

const USDC_COMET_LINEA = '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991';
const WETH_COMET_LINEA = '0x60F2058379716A64a7A5d29219397e79bC552194';

const COMET_FACTORY_V2_LINEA = '0xb07302209d25D0dA8100D0C9AC061259eEfe531a';

const USDC_EXT_LINEA = '0x9A830d83768636eAF68E317260adE822c5f3db9D';
const WETH_EXT_LINEA = '0xCfcdeA31c11FE002d7488Bd714c630E67cf72D71';

////

const USDC_COMET_SCROLL = '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44';

const COMET_FACTORY_V2_SCROLL = '0xBE1b3e95c8fE0Cb9B6E825c9F7E1bfbb7855B227';

const USDC_EXT_SCROLL = '0x4DA8f56c46Dc7195FBfF1C775327C13feE7eadAd';

const BRIDGE_RECEIVER_SCROLL = '0xC6bf5A64896D679Cf89843DbeC6c0f5d3C9b610D';
const COMET_ADMIN_SCROLL = '0x87A27b91f4130a25E9634d23A5B8E05e342bac50';
const CONFIGURATOR_SCROLL = '0xECAB0bEEa3e5DEa0c35d3E69468EAC20098032D7';

export default migration('1778158953_update_to_v2_factory', {
  async prepare(
    // deploymentManager: DeploymentManager
  ) {

    // const cometUSDC = new Contract(
    //   USDC_COMET_LINEA,
    //   ['function extensionDelegate() external view returns (address)'],
    //   await deploymentManager.getSigner()
    // );

    // const lineaAssetListFactoryAddress = '0x2F4eAF29dfeeF4654bD091F7112926E108eF4Ed0';

    // const extensionDelegateUSDC = new Contract(
    //   await cometUSDC.extensionDelegate(),
    //   [
    //     'function name() external view returns (string)',
    //     'function symbol() external view returns (string)',
    //   ],
    //   await deploymentManager.getSigner()
    // );
    // const nameUSDC = await extensionDelegateUSDC.name();
    // const symbolUSDC = await extensionDelegateUSDC.symbol();

    // console.log('USDC constructor args',
    //   utils.defaultAbiCoder.encode(
    //     ['tuple(bytes32,bytes32)', 'address'],
    //     [
    //       [
    //         utils.formatBytes32String(nameUSDC),
    //         utils.formatBytes32String(symbolUSDC)
    //       ],
    //       lineaAssetListFactoryAddress
    //     ]
    //   )
    // );

    // const cometWETH = new Contract(
    //   WETH_COMET_LINEA,
    //   ['function extensionDelegate() external view returns (address)'],
    //   await deploymentManager.getSigner()
    // );

    // const extensionDelegateWETH = new Contract(
    //   await cometWETH.extensionDelegate(),
    //   [
    //     'function name() external view returns (string)',
    //     'function symbol() external view returns (string)',
    //   ],
    //   await deploymentManager.getSigner()
    // );
    // const nameWETH = await extensionDelegateWETH.name();
    // const symbolWETH = await extensionDelegateWETH.symbol();

    // console.log('WETH constructor args',
    //   utils.defaultAbiCoder.encode(
    //     ['(bytes32,bytes32)', 'address'],
    //     [
    //       [
    //         utils.formatBytes32String(nameWETH),
    //         utils.formatBytes32String(symbolWETH)
    //       ],
    //       lineaAssetListFactoryAddress
    //     ]
    //   )
    // );
    
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
      scrollMessenger,
      governor,
    } = await govDeploymentManager.getContracts();

    const newFactory = await deploymentManager.existing(
      'cometFactoryV2',
      COMET_FACTORY_V2_LINEA,
      'linea'
    );

    const setConfigurationCalldataUsdcLinea = await calldata(
      configurator.populateTransaction.setFactory(USDC_COMET_LINEA, newFactory.address)
    );
    const setExtensionDelegateCalldataUsdcLinea = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDC_COMET_LINEA, USDC_EXT_LINEA)
    );
    const deployAndUpgradeToCalldataUsdcLinea = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET_LINEA]
    );

    const setConfigurationCalldataWethLinea = await calldata(
      configurator.populateTransaction.setFactory(WETH_COMET_LINEA, newFactory.address)
    );
    const setExtensionDelegateCalldataWethLinea = await calldata(
      configurator.populateTransaction.setExtensionDelegate(WETH_COMET_LINEA, WETH_EXT_LINEA)
    );
    const deployAndUpgradeToCalldataWethLinea = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, WETH_COMET_LINEA]
    );

    const l2ProposalDataLinea = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, configurator.address, cometAdmin.address,
          configurator.address, configurator.address, cometAdmin.address
        ],
        [
          0, 0, 0,
          0, 0, 0
        ],
        [
          'setFactory(address,address)',
          'setExtensionDelegate(address,address)',
          'deployAndUpgradeTo(address,address)',
          'setFactory(address,address)',
          'setExtensionDelegate(address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setConfigurationCalldataUsdcLinea, setExtensionDelegateCalldataUsdcLinea, deployAndUpgradeToCalldataUsdcLinea,
          setConfigurationCalldataWethLinea, setExtensionDelegateCalldataWethLinea,  deployAndUpgradeToCalldataWethLinea
        ]
      ]
    );

    // Scroll    
    const setConfigurationCalldataUsdcScroll = await calldata(
      configurator.populateTransaction.setFactory(USDC_COMET_SCROLL, COMET_FACTORY_V2_SCROLL)
    );
    const setExtensionDelegateCalldataUsdcScroll = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDC_COMET_SCROLL, USDC_EXT_SCROLL)
    );
    const deployAndUpgradeToCalldataUsdcScroll = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET_SCROLL]
    );

    const l2ProposalDataScroll = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          CONFIGURATOR_SCROLL, CONFIGURATOR_SCROLL, COMET_ADMIN_SCROLL,
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
          setConfigurationCalldataUsdcScroll, setExtensionDelegateCalldataUsdcScroll, deployAndUpgradeToCalldataUsdcScroll,
        ]
      ]
    );

    const mainnetActions = [
      // 1. Update USDC and WETH Comet on Linea to the service patch version
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [bridgeReceiver.address, 0, l2ProposalDataLinea],
      },
      // 2. Update USDC Comet to the service patch version
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [BRIDGE_RECEIVER_SCROLL, 0, l2ProposalDataScroll, 1_000_000],
        value: exp(0.05, 18)
      },
    ];

    const description = `# Update Linea and Scroll Comets to the service patch version

## Proposal summary

WOOF! proposes upgrading the Linea cUSDCv3, cWETHv3, and Scroll cUSDCv3 Comet markets to a new service patch version introducing several improvements and security enhancements:

- Extended Pause Controls: collateral interactions can now be paused independently per collateral asset.
- Price Feed Patch (Post-USDM incident response): skips price feed calls for assets with zero collateral factor, preventing unnecessary reverts.
- Collateral Deactivation Mechanism: introduces a Guardian-controlled emergency mechanism to deactivate unsafe collateral assets, with reactivation requiring a governance proposal.
- Utilization Peaking Protection: caps utilization at 200%, preventing additional borrowing when post-borrow utilization exceeds this threshold, while preserving lender withdrawals.
- Borrow Index Fix (Empty Market): prevents borrow interest accrual in markets without active borrowers.
- Supply Index Fix (Empty Market): ensures supply index only accrues when lenders are present.
- Lender Illiquidity Fix in Zero-Borrow Markets: prevents reserve depletion in markets with no borrowers by capping supply rate to zero when utilization is zero and reserves are exhausted.
- Accrue Interest on Collateral Actions (Post-USDM incident response): collateral actions (supply, withdraw, transfer) now trigger interest accrual for affected accounts.
- Technical Improvements: includes removal of redundant arguments in supplyInternal() and optimized price caching in absorbInternal(), improving gas efficiency without affecting protocol behavior.

This proposal takes the governance steps recommended and necessary to update Compound III USDC and WETH markets on Linea and Scroll. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).

Detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1118) and [forum discussion](<>).

### Bytecode Repository

This update is done with the use of the bytecode repository, which provides trustless and deterministic deployments.

Further details on the deployment can be found in the [Bytecode Repository git](https://github.com/woof-software/bytecode-repository) and [forum discussion](https://www.comp.xyz/t/rfc-bytecode-repository-and-deployment-pipeline-modernization/6965).

### Audit

Both service patch Comet update and Bytecode Repository have been audited by Certora and full reports can be found here:

- [Certora Comet Service Patch Audit](https://www.certora.com/reports/comet-service-patch)
- [Certora Bytecode Repository Audit](https://www.certora.com/reports/compound-bytecoderepository)

## Proposal Actions

The first action sets the factory to the newly deployed factory, extension delegate to the newly deployed contract and deploys and upgrades Comet to a new version on Linea.

The second action sets the factory to the newly deployed factory, extension delegate to the newly deployed contract and deploys and upgrades Comet to a new version on Scroll.`;
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

    expect(await configurator.factory(USDC_COMET_LINEA)).to.equal(COMET_FACTORY_V2_LINEA);
    expect(await configurator.factory(WETH_COMET_LINEA)).to.equal(COMET_FACTORY_V2_LINEA);

    expect((await configurator.getConfiguration(USDC_COMET_LINEA)).extensionDelegate).to.equal(USDC_EXT_LINEA);
    expect((await configurator.getConfiguration(WETH_COMET_LINEA)).extensionDelegate).to.equal(WETH_EXT_LINEA);

    const expectedMaxUtilization = exp(2, 18);
    const signer = await deploymentManager.getSigner();

    const newCometUsdc = new Contract(
      USDC_COMET_LINEA, 
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
    expect(await newCometUsdc.extensionDelegate()).to.equal(USDC_EXT_LINEA);

    const newCometWeth = new Contract(
      WETH_COMET_LINEA, 
      [
        'function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)',
        'function symbol() external view returns (string)',
        'function name() external view returns (string)',
        'function extensionDelegate() external view returns (address)',
      ],
      signer
    );

    expect(await newCometWeth.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
    expect(await newCometWeth.symbol()).to.equal('cWETHv3');
    expect(await newCometWeth.name()).to.equal('Compound WETH');
    expect(await newCometWeth.extensionDelegate()).to.equal(WETH_EXT_LINEA);
  },
});
