import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';

let newCometExtAddressWETH: string;
let newCometExtAddressWSTETH: string;
const WSTETH_COMET = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';
const WSTETH_EXT = '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214';

export default migration('1735299752_update_comet_to_support_more_collaterals', {
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

    const extensionDelegateWETH = new Contract(
      await comet.extensionDelegate(),
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

    const extensionDelegateWstETH = new Contract(
      WSTETH_EXT,
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      await deploymentManager.getSigner()
    );

    const nameWstETH = await extensionDelegateWstETH.name();
    const symbolWstETH = await extensionDelegateWstETH.symbol();

    const _newCometExtWstETH = await deploymentManager.deploy(
      'CometExtAssetList',
      'CometExtAssetList.sol',
      [
        {
          name32: ethers.utils.formatBytes32String(nameWstETH),
          symbol32: ethers.utils.formatBytes32String(symbolWstETH)
        },
        _assetListFactory.address
      ],
      true
    );
    return {
      cometFactoryWithExtendedAssetList: cometFactoryWithExtendedAssetList.address,
      newCometExtWETH: _newCometExtWETH.address,
      newCometExtWstETH: _newCometExtWstETH.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    cometFactoryWithExtendedAssetList,
    newCometExtWETH,
    newCometExtWstETH,
  }) {

    const trace = deploymentManager.tracer();
    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    newCometExtAddressWETH = newCometExtWETH;
    newCometExtAddressWSTETH = newCometExtWstETH;

    const mainnetActions = [
      // 1. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactoryWithExtendedAssetList],
      },
      // 2. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [WSTETH_COMET, cometFactoryWithExtendedAssetList],
      },
      // 3. Set new CometExt as the extension delegate
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [comet.address, newCometExtWETH],
      },
      // 4. Set new CometExt as the extension delegate
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [WSTETH_COMET, newCometExtWstETH],
      },
      // 5. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
      // 6. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WSTETH_COMET],
      },
    ];

    const description = '# Update WETH and wstETH Comets on Mainnet to support more collaterals\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to update 2 Comets to a new version, which supports up to 24 collaterals. This proposal takes the governance steps recommended and necessary to update a Compound III WETH and wstETH markets on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nDetailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/904), [deploy market GitHub action run](<>) and [forum discussion](https://www.comp.xyz/t/increase-amount-of-collaterals-in-comet/5465).\n\n\n## Proposal Actions\n\nThe first action sets the factory for cWETHv3 to the newly deployed factory.\n\nThe second action sets the factory for cwstETHv3 to the newly deployed factory.\n\nThe third action sets the extension delegate for cWETHv3 to the newly deployed contract.\n\nThe fourth action sets the extension delegate for cwstETHv3 to the newly deployed contract.\n\nThe fifth action deploys and upgrades cWETHv3  to a new version.\n\nThe sixth action deploys and upgrades cwstETHv3 to a new version.';
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
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddressWETH);

    const cometNewWSTETH = new Contract(
      WSTETH_COMET,
      [
        'function assetList() external view returns (address)',
        'function extensionDelegate() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddressWSTETH = await cometNewWSTETH.assetList();

    expect(assetListAddressWSTETH).to.not.be.equal(ethers.constants.AddressZero);
    expect(await cometNewWSTETH.extensionDelegate()).to.be.equal(newCometExtAddressWSTETH);
  },
});
