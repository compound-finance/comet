import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

let newCometExtAddress: string;

const USDCE_COMET = '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA';
const USDT_COMET = '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07';
const WETH_COMET = '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486';

export default migration('1735299626_update_comet_to_support_more_collaterals', {
  async prepare(deploymentManager: DeploymentManager) {
    const _assetListFactory = await deploymentManager.deploy(
      'assetListFactory',
      'AssetListFactory.sol',
      []
    );

    const cometFactoryWithExtendedAssetList = await deploymentManager.deploy(
      'cometFactoryWithExtendedAssetList',
      'CometFactoryWithExtendedAssetList.sol',
      []
    );
    const {
      comet
    } = await deploymentManager.getContracts();

    const extensionDelegate = new Contract(
      await comet.extensionDelegate(),
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      deploymentManager.hre.ethers.provider
    );
    const name = await extensionDelegate.name();
    const symbol = await extensionDelegate.symbol();

    const _newCometExt = await deploymentManager.deploy(
      'CometExtAssetList',
      'CometExtAssetList.sol',
      [
        {
          name32: ethers.utils.formatBytes32String(name),
          symbol32: ethers.utils.formatBytes32String(symbol)
        },
        _assetListFactory.address
      ]
    );
    return {
      cometFactoryWithExtendedAssetList: cometFactoryWithExtendedAssetList.address,
      newCometExt: _newCometExt.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    cometFactoryWithExtendedAssetList,
    newCometExt,
  }) {

    const trace = deploymentManager.tracer();
    const {
      comet,
      cometAdmin,
      configurator,
      bridgeReceiver,
      timelock: l2Timelock,
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    newCometExtAddress = newCometExt;

    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldata = await calldata(
      configurator.populateTransaction.setExtensionDelegate(comet.address, newCometExt)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const setFactoryCalldataUSDCE = await calldata(
      configurator.populateTransaction.setFactory(USDCE_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataUSDCE = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDCE_COMET, newCometExt)
    );
    const deployAndUpgradeToCalldataUSDCE = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDCE_COMET]
    );

    const setFactoryCalldataUSDT = await calldata(
      configurator.populateTransaction.setFactory(USDT_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataUSDT = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDT_COMET, newCometExt)
    );
    const deployAndUpgradeToCalldataUSDT = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDT_COMET]
    );

    const setFactoryCalldataWETH = await calldata(
      configurator.populateTransaction.setFactory(WETH_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataWETH = await calldata(
      configurator.populateTransaction.setExtensionDelegate(WETH_COMET, newCometExt)
    );
    const deployAndUpgradeToCalldataWETH = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, WETH_COMET]
    );


    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, configurator.address, cometAdmin.address,
          configurator.address, configurator.address, cometAdmin.address,
          configurator.address, configurator.address, cometAdmin.address,
          configurator.address, configurator.address, cometAdmin.address,
        ],
        [
          0, 0, 0,
          0, 0, 0,
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
          'setFactory(address,address)',
          'setExtensionDelegate(address,address)',
          'deployAndUpgradeTo(address,address)',
          'setFactory(address,address)',
          'setExtensionDelegate(address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          setFactoryCalldata, setExtensionDelegateCalldata, deployAndUpgradeToCalldata,
          setFactoryCalldataUSDCE, setExtensionDelegateCalldataUSDCE, deployAndUpgradeToCalldataUSDCE,
          setFactoryCalldataUSDT, setExtensionDelegateCalldataUSDT, deployAndUpgradeToCalldataUSDT,
          setFactoryCalldataWETH, setExtensionDelegateCalldataWETH, deployAndUpgradeToCalldataWETH,
        ],
      ]
    );

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );
    const refundAddress = l2Timelock.address;

    const mainnetActions = [
      // 1. Sends the proposal to the L2
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
      },
    ];

    const description = '# Update USDC, USDT, WETH and USDC.e Comets on Arbitrum to support more collaterals\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to update 4 Comets to a new version, which supports up to 24 collaterals. This proposal takes the governance steps recommended and necessary to update Compound III USDT, USDC, WETH and USDC.e markets on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nDetailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/904) and [forum discussion](https://www.comp.xyz/t/increase-amount-of-collaterals-in-comet/5465).\n\n\n## Proposal Actions\n\nThe first action sets the factory to the newly deployed factory, extension delegate to the newly deployed contract and deploys and upgrades Comet to a new version for all 4 comets: cUSDTv3, cUSDCv3, cWETHv3 and cUSDCev3.';
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet } = await deploymentManager.getContracts();

    const cometNew = new Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const assetListAddress = await cometNew.assetList();

    expect(assetListAddress).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddress);

    const cometNewUSDCE = new Contract(
      USDCE_COMET,
      [
        'function assetList() external view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const assetListAddressUSDCE = await cometNewUSDCE.assetList();

    expect(assetListAddressUSDCE).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddress);

    const cometNewUSDT = new Contract(
      USDT_COMET,
      [
        'function assetList() external view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const assetListAddressUSDT = await cometNewUSDT.assetList();

    expect(assetListAddressUSDT).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddress);

    const cometNewWETH = new Contract(
      WETH_COMET,
      [
        'function assetList() external view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const assetListAddressWETH = await cometNewWETH.assetList();

    expect(assetListAddressWETH).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddress);
  },
});
