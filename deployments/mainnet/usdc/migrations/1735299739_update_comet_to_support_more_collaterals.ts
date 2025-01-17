import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';

let newCometExtAddress: string;

const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';

export default migration('1735299739_update_comet_to_support_more_collaterals', {
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

  async enact(deploymentManager: DeploymentManager, _, {
    cometFactoryWithExtendedAssetList,
    newCometExt,
  }) {

    const trace = deploymentManager.tracer();
    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    newCometExtAddress = newCometExt;

    const mainnetActions = [
      // 1. Set the factory in the Configurator for the USDC comet
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactoryWithExtendedAssetList],
      },
      // 2. Set the factory in the Configurator for the USDS comet
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDS_COMET, cometFactoryWithExtendedAssetList],
      },
      // 3. Set the factory in the Configurator for the USDT comet
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDT_COMET, cometFactoryWithExtendedAssetList],
      },
      // 4. Set new CometExt as the extension delegate for the USDC comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [comet.address, newCometExt],
      },
      // 5. Set new CometExt as the extension delegate for the USDS comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDS_COMET, newCometExt],
      },
      // 6. Set new CometExt as the extension delegate for the USDT comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDT_COMET, newCometExt],
      },
      // 7. Deploy and upgrade to a new version of Comet for the USDC comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
      // 8. Deploy and upgrade to a new version of Comet for the USDS comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDS_COMET],
      },
      // 9. Deploy and upgrade to a new version of Comet for the USDT comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDT_COMET],
      },
    ];

    const { timelock } = await deploymentManager.getContracts();
    // impersonate the timelock
    await deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelock.address],
    });

    const description = '# Update USDC, USDT and USDS Comets on Mainnet to support more collaterals\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to update 3 Comets to a new version, which supports up to 24 collaterals. This proposal takes the governance steps recommended and necessary to update a Compound III USDC, USDT and USDS markets on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nDetailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/904) and [forum discussion](https://www.comp.xyz/t/increase-amount-of-collaterals-in-comet/5465).\n\n\n## Proposal Actions\n\nThe first action sets the factory for cUSDCv3 to the newly deployed factory.\n\nThe second action sets the extension delegate for cUSDCv3  to the newly deployed contract.\n\nThe third action deploys and upgrades cUSDCv3  to a new version.\n\nThe fourth action sets the factory for cUSDTv3 to the newly deployed factory.\n\nThe fifth action sets the extension delegate for cUSDTv3  to the newly deployed contract.\n\nThe sixth action deploys and upgrades cUSDTv3  to a new version.\n\nThe seventh action sets the factory for cUSDSv3 to the newly deployed factory.\n\nThe eighth action sets the extension delegate for cUSDSv3  to the newly deployed contract.\n\nThe ninth action deploys and upgrades cUSDSv3  to a new version.';
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

    const cometNewUSDC = new Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const assetListAddressUSDC = await cometNewUSDC.assetList();

    expect(assetListAddressUSDC).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddress);

    const cometNewUSDS = new Contract(
      USDS_COMET,
      [
        'function assetList() external view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const assetListAddressUSDS = await cometNewUSDS.assetList();

    expect(assetListAddressUSDS).to.not.be.equal(ethers.constants.AddressZero);
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
  },
});
