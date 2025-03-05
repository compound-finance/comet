import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';
import { utils } from 'ethers';

let newCometExtAddressUSDC: string;
let newCometExtAddressUSDT: string;

const USDT_COMET = '0xaeB318360f27748Acb200CE616E389A6C9409a07';
const USDT_EXT = '0x2F4eAF29dfeeF4654bD091F7112926E108eF4Ed0';

export default migration('1735299827_update_comet_to_support_more_collaterals', {
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
    return {
      cometFactoryWithExtendedAssetList: cometFactoryWithExtendedAssetList.address,
      newCometExtUSDC: _newCometExtUSDC.address,
      newCometExtUSDT: _newCometExtUSDT.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    cometFactoryWithExtendedAssetList,
    newCometExtUSDC,
    newCometExtUSDT
  }) {

    const trace = deploymentManager.tracer();
    const {
      comet,
      cometAdmin,
      configurator,
      bridgeReceiver,
    } = await deploymentManager.getContracts();
    const { governor, fxRoot } = await govDeploymentManager.getContracts();

    newCometExtAddressUSDC = newCometExtUSDC;
    newCometExtAddressUSDT = newCometExtUSDT;

    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactoryWithExtendedAssetList)
    );
    const setExtensionDelegateCalldata = await calldata(
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

    const l2ProposalData = utils.defaultAbiCoder.encode(
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
          setFactoryCalldata, setExtensionDelegateCalldata, deployAndUpgradeToCalldata,
          setFactoryCalldataUSDT, setExtensionDelegateCalldataUSDT, deployAndUpgradeToCalldataUSDT
        ],
      ]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData],
      },
    ];

    const description = '# Update USDC and USDT Comets on Polygon to support more collaterals\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to update 2 Comets to a new version, which supports up to 24 collaterals. This proposal takes the governance steps recommended and necessary to update Compound III USDT and USDC markets on Polygon. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nDetailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/904) and [forum discussion](https://www.comp.xyz/t/increase-amount-of-collaterals-in-comet/5465).\n\n\n## Proposal Actions\n\nThe first action sets the factory to the newly deployed factory, extension delegate to the newly deployed contract and deploys and upgrades Comet to a new version for all 2 comets: cUSDTv3 and cUSDCv3.';
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
    return true;
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

    const assetListAddressUSDT = await cometNewUSDT.assetList();

    expect(assetListAddressUSDT).to.not.be.equal(ethers.constants.AddressZero);
    expect(await cometNewUSDT.extensionDelegate()).to.be.equal(newCometExtAddressUSDT);
  },
});
