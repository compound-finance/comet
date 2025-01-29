import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';
import { utils } from 'ethers';

let newCometExtAddressUSDC: string;
let newCometExtAddressUSDT: string;
let newCometExtAddressWETH: string;

const USDT_COMET = '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214';
const USDT_EXT = '0xC49399814452B41dA8a7cd76a159f5515cb3e493';
const WETH_COMET = '0xE36A30D249f7761327fd973001A32010b521b6Fd';
const WETH_EXT = '0x82B8d9A06ccABC1e9B0c0A00f38B858E6925CF2f';

export default migration('1735299799_update_comet_to_support_more_collaterals', {
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

    const extensionDelegateUSDC = new Contract(
      await comet.extensionDelegate(),
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

    const extensionDelegateUSDT = new Contract(
      USDT_EXT,
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      await deploymentManager.getSigner()
    );

    const nameUSDT = await extensionDelegateUSDT.name();
    const symbolUSDT = await extensionDelegateUSDT.symbol();

    const _newCometExtUSDT = await deploymentManager.deploy(
      'CometExtAssetList',
      'CometExtAssetList.sol',
      [
        {
          name32: ethers.utils.formatBytes32String(nameUSDT),
          symbol32: ethers.utils.formatBytes32String(symbolUSDT)
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
    return {
      cometFactoryWithExtendedAssetList: cometFactoryWithExtendedAssetList.address,
      newCometExtUSDC: _newCometExtUSDC.address,
      newCometExtUSDT: _newCometExtUSDT.address,
      newCometExtWETH: _newCometExtWETH.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    cometFactoryWithExtendedAssetList,
    newCometExtUSDC,
    newCometExtUSDT,
    newCometExtWETH,
  }) {

    newCometExtAddressUSDC = newCometExtUSDC;
    newCometExtAddressUSDT = newCometExtUSDT;
    newCometExtAddressWETH = newCometExtWETH;

    const trace = deploymentManager.tracer();
    const {
      comet,
      cometAdmin,
      configurator,
      bridgeReceiver,
    } = await deploymentManager.getContracts();
    const { governor, opL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataUSDC = await calldata(
      configurator.populateTransaction.setExtensionDelegate(comet.address, newCometExtUSDC)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const setFactoryCalldataUSDT = await calldata(
      configurator.populateTransaction.setFactory(USDT_COMET, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldataUSDT = await calldata(
      configurator.populateTransaction.setExtensionDelegate(USDT_COMET, newCometExtUSDT)
    );
    const deployAndUpgradeToCalldataUSDT = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, USDT_COMET]
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

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address, configurator.address, cometAdmin.address,
          configurator.address, configurator.address, cometAdmin.address,
          configurator.address, configurator.address, cometAdmin.address,
        ],
        [
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
        ],
        [
          setFactoryCalldata, setExtensionDelegateCalldataUSDC, deployAndUpgradeToCalldata,
          setFactoryCalldataUSDT, setExtensionDelegateCalldataUSDT, deployAndUpgradeToCalldataUSDT,
          setFactoryCalldataWETH, setExtensionDelegateCalldataWETH, deployAndUpgradeToCalldataWETH,
        ],
      ]
    );

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = '# Update USDC, USDT and WETH Comets on Optimism to support more collaterals\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to update 4 Comets to a new version, which supports up to 24 collaterals. This proposal takes the governance steps recommended and necessary to update Compound III USDT, USDC and WETH markets on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nDetailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/904) and [forum discussion](https://www.comp.xyz/t/increase-amount-of-collaterals-in-comet/5465).\n\n\n## Proposal Actions\n\nThe first action sets the factory to the newly deployed factory, extension delegate to the newly deployed contract and deploys and upgrades Comet to a new version for all 3 comets: cUSDTv3, cUSDCv3 and cWETHv3.';
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
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddressUSDC);

    const cometNewUSDT = new Contract(
      USDT_COMET,
      [
        'function assetList() external view returns (address)',
        'function extensionDelegate() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddressUSDC = await cometNewUSDT.assetList();

    expect(assetListAddressUSDC).to.not.be.equal(ethers.constants.AddressZero);
    expect(await cometNewUSDT.extensionDelegate()).to.be.equal(newCometExtAddressUSDT);

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
  },
});
