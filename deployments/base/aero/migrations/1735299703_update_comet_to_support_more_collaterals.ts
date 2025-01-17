import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';
import { utils } from 'ethers';

let newCometExtAddress: string;

const USDC_COMET = '0xb125E6687d4313864e53df431d5425969c15Eb2F';
const WETH_COMET = '0x46e6b214b524310239732D51387075E0e70970bf';
const USDBC_COMET = '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf';

export default migration('1735299703_update_comet_to_support_more_collaterals', {
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
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
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

    const setFactoryCalldataUSDC = await calldata(
      configurator.populateTransaction.setFactory(USDC_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataUSDC = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDC_COMET, newCometExt)
    );
    const deployAndUpgradeToCalldataUSDC = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET]
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

    const setFactoryCalldataUSDBC = await calldata(
      configurator.populateTransaction.setFactory(USDBC_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataUSDBC = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDBC_COMET, newCometExt)
    );
    const deployAndUpgradeToCalldataUSDBC = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDBC_COMET]
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
          setFactoryCalldataUSDC, setExtensionDelegateCalldataUSDC, deployAndUpgradeToCalldataUSDC,
          setFactoryCalldataWETH, setExtensionDelegateCalldataWETH, deployAndUpgradeToCalldataWETH,
          setFactoryCalldataUSDBC, setExtensionDelegateCalldataUSDBC, deployAndUpgradeToCalldataUSDBC,
        ],
      ]
    );

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = '# Update AERO, USDC, WETH and USDbC Comets on Base to support more collaterals\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to update 4 Comets to a new version, which supports up to 24 collaterals. This proposal takes the governance steps recommended and necessary to update a Compound III AERO, USDC, WETH and USDbC markets on Base. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nDetailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/904) and [forum discussion](https://www.comp.xyz/t/increase-amount-of-collaterals-in-comet/5465).\n\n\n## Proposal Actions\n\nThe first action sets the factory to the newly deployed factory, extension delegate to the newly deployed contract and deploys and upgrades Comet to a new version for all 4 comets: cAEROv3, cUSDCv3, cWETHv3 and cUSDbCv3.';
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

    const cometNewUSDC = new Contract(
      USDC_COMET,
      [
        'function assetList() external view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const assetListAddressUSDC = await cometNewUSDC.assetList();

    expect(assetListAddressUSDC).to.not.be.equal(ethers.constants.AddressZero);
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

    const cometNewUSDBC = new Contract(
      USDBC_COMET,
      [
        'function assetList() external view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const assetListAddressUSDBC = await cometNewUSDBC.assetList();

    expect(assetListAddressUSDBC).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddress);
  },
});
