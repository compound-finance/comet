import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';
import { utils } from 'ethers';

let newCometExtAddressAERO: string;
let newCometExtAddressUSDC: string;
let newCometExtAddressWETH: string;
let newCometExtAddressUSDBC: string;

const USDC_COMET = '0xb125E6687d4313864e53df431d5425969c15Eb2F';
const USDC_EXT = '0x3bac64185786922292266AA92a58cf870D694E2a';
const WETH_COMET = '0x46e6b214b524310239732D51387075E0e70970bf';
const WETH_EXT = '0x88bB8C109640778D3fB1074bB10a66e31F2c9c17';
const USDBC_COMET = '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf';
const USDBC_EXT = '0x2F9E3953b2Ef89fA265f2a32ed9F80D00229125B';

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

    const extensionDelegateAERO = new Contract(
      await comet.extensionDelegate(),
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      await deploymentManager.getSigner()
    );
    const nameAERO = await extensionDelegateAERO.name();
    const symbolAERO = await extensionDelegateAERO.symbol();

    const _newCometExtAERO = await deploymentManager.deploy(
      'CometExtAssetList',
      'CometExtAssetList.sol',
      [
        {
          name32: ethers.utils.formatBytes32String(nameAERO),
          symbol32: ethers.utils.formatBytes32String(symbolAERO)
        },
        _assetListFactory.address
      ],
      true
    );

    const extensionDelegateUSDC = new Contract(
      USDC_EXT,
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      await deploymentManager.getSigner()
    );

    const nameUSDC = await extensionDelegateUSDC.name();
    const symbolUSDC = await extensionDelegateUSDC.symbol();

    const _newCometExtUSDC = await deploymentManager.deploy(
      'CometExtAssetList',
      'CometExtAssetList.sol',
      [
        {
          name32: ethers.utils.formatBytes32String(nameUSDC),
          symbol32: ethers.utils.formatBytes32String(symbolUSDC)
        },
        _assetListFactory.address
      ],
      true
    );

    const extensionDelegateWETH = new Contract(
      WETH_EXT,
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      await deploymentManager.getSigner()
    );
    const nameWETH = await extensionDelegateWETH.name();
    const symbolWETH = await extensionDelegateWETH.symbol();

    const _newCometExtWETH = await deploymentManager.deploy(
      'CometExtAssetList',
      'CometExtAssetList.sol',
      [
        {
          name32: ethers.utils.formatBytes32String(nameWETH),
          symbol32: ethers.utils.formatBytes32String(symbolWETH)
        },
        _assetListFactory.address
      ],
      true
    );

    const extensionDelegateUSDBC = new Contract(
      USDBC_EXT,
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      await deploymentManager.getSigner()
    );
    const nameUSDBC = await extensionDelegateUSDBC.name();
    const symbolUSDBC = await extensionDelegateUSDBC.symbol();

    const _newCometExtUSDBC = await deploymentManager.deploy(
      'CometExtAssetList',
      'CometExtAssetList.sol',
      [
        {
          name32: ethers.utils.formatBytes32String(nameUSDBC),
          symbol32: ethers.utils.formatBytes32String(symbolUSDBC)
        },
        _assetListFactory.address
      ],
      true
    );
    return {
      cometFactoryWithExtendedAssetList: cometFactoryWithExtendedAssetList.address,
      newCometExtAERO: _newCometExtAERO.address,
      newCometExtUSDC: _newCometExtUSDC.address,
      newCometExtWETH: _newCometExtWETH.address,
      newCometExtUSDBC: _newCometExtUSDBC.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    cometFactoryWithExtendedAssetList,
    newCometExtAERO,
    newCometExtUSDC,
    newCometExtWETH,
    newCometExtUSDBC,
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

    newCometExtAddressAERO = newCometExtAERO;
    newCometExtAddressUSDC = newCometExtUSDC;
    newCometExtAddressWETH = newCometExtWETH;
    newCometExtAddressUSDBC = newCometExtUSDBC;

    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldata = await calldata(
      configurator.populateTransaction.setExtensionDelegate(comet.address, newCometExtAERO)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const setFactoryCalldataUSDC = await calldata(
      configurator.populateTransaction.setFactory(USDC_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataUSDC = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDC_COMET, newCometExtUSDC)
    );
    const deployAndUpgradeToCalldataUSDC = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDC_COMET]
    );

    const setFactoryCalldataWETH = await calldata(
      configurator.populateTransaction.setFactory(WETH_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataWETH = await calldata(
      configurator.populateTransaction.setExtensionDelegate(WETH_COMET, newCometExtWETH)
    );
    const deployAndUpgradeToCalldataWETH = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, WETH_COMET]
    );

    const setFactoryCalldataUSDBC = await calldata(
      configurator.populateTransaction.setFactory(USDBC_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataUSDBC = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDBC_COMET, newCometExtUSDBC)
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
      await deploymentManager.getSigner()
    );

    const assetListAddress = await cometNew.assetList();

    expect(assetListAddress).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddressAERO);

    const cometNewUSDC = new Contract(
      USDC_COMET,
      [
        'function assetList() external view returns (address)',
        'function extensionDelegate() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddressUSDC = await cometNewUSDC.assetList();

    expect(assetListAddressUSDC).to.not.be.equal(ethers.constants.AddressZero);
    expect(await cometNewUSDC.extensionDelegate()).to.be.equal(newCometExtAddressUSDC);

    const cometNewWETH = new Contract(
      WETH_COMET,
      [
        'function assetList() external view returns (address)',
        'function extensionDelegate() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddressWETH = await cometNewWETH.assetList();

    expect(assetListAddressWETH).to.not.be.equal(ethers.constants.AddressZero);
    expect(await cometNewWETH.extensionDelegate()).to.be.equal(newCometExtAddressWETH);

    const cometNewUSDBC = new Contract(
      USDBC_COMET,
      [
        'function assetList() external view returns (address)',
        'function extensionDelegate() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddressUSDBC = await cometNewUSDBC.assetList();

    expect(assetListAddressUSDBC).to.not.be.equal(ethers.constants.AddressZero);
    expect(await cometNewUSDBC.extensionDelegate()).to.be.equal(newCometExtAddressUSDBC);
  },
});
