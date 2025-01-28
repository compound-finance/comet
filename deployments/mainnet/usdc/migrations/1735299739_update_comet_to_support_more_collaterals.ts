import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';
import { Contract } from 'ethers';

let newCometExtAddressUSDC: string;
let newCometExtAddressUSDS: string;
let newCometExtAddressUSDT: string;

const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
const USDS_EXT = '0x95DeDD64b551F05E9f59a101a519B024b6b116E7';
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';
const USDT_EXT = '0x5C58d4479A1E9b2d19EE052143FA73F0ee79A36e';

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

    const extensionDelegateUSDS = new Contract(
      USDS_EXT,
      [
        'function name() external view returns (string)',
        'function symbol() external view returns (string)',
      ],
      await deploymentManager.getSigner()
    );
    const nameUSDS = await extensionDelegateUSDS.name();
    const symbolUSDS = await extensionDelegateUSDS.symbol();

    const _newCometExtUSDS = await deploymentManager.deploy(
      'CometExtAssetList',
      'CometExtAssetList.sol',
      [
        {
          name32: ethers.utils.formatBytes32String(nameUSDS),
          symbol32: ethers.utils.formatBytes32String(symbolUSDS)
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
      newCometExtUSDS: _newCometExtUSDS.address,
      newCometExtUSDT: _newCometExtUSDT.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    cometFactoryWithExtendedAssetList,
    newCometExtUSDC,
    newCometExtUSDS,
    newCometExtUSDT
  }) {

    const trace = deploymentManager.tracer();
    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    newCometExtAddressUSDC = newCometExtUSDC;
    newCometExtAddressUSDS = newCometExtUSDS;
    newCometExtAddressUSDT = newCometExtUSDT;

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
        args: [comet.address, newCometExtUSDC],
      },
      // 5. Set new CometExt as the extension delegate for the USDS comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDS_COMET, newCometExtUSDS],
      },
      // 6. Set new CometExt as the extension delegate for the USDT comet
      {
        contract: configurator,
        signature: 'setExtensionDelegate(address,address)',
        args: [USDT_COMET, newCometExtUSDT],
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

    const description = '# Update USDC, USDT and USDS Comets on Mainnet to support more collaterals\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to update 3 Comet to a new version, which supports up to 24 collaterals. This proposal takes the governance steps recommended and necessary to update a Compound III USDC, USDT and USDS markets on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).\n\nDetailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/904), [deploy market GitHub action run](<>) and [forum discussion](https://www.comp.xyz/t/increase-amount-of-collaterals-in-comet/5465).\n\n\n## Proposal Actions\n\nThe first action sets the factory for cUSDCv3 to the newly deployed factory.\n\nThe second action sets the factory for cUSDSv3 to the newly deployed factory.\n\nThe third action sets the factory for cUSDTv3 to the newly deployed factory.\n\nThe fourth action sets the extension delegate for cUSDCv3  to the newly deployed contract.\n\nThe fifth action sets the extension delegate for cUSDSv3  to the newly deployed contract.\n\nThe sixth action sets the extension delegate for cUSDTv3  to the newly deployed contract.\n\nThe seventh action deploys and upgrades cUSDCv3  to a new version.\n\nThe eighth action deploys and upgrades cUSDSv3  to a new version.\n\nThe ninth action deploys and upgrades cUSDTv3  to a new version.';
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet } = await deploymentManager.getContracts();

    const cometNewUSDC = new Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddressUSDC = await cometNewUSDC.assetList();

    expect(assetListAddressUSDC).to.not.be.equal(ethers.constants.AddressZero);
    expect(await comet.extensionDelegate()).to.be.equal(newCometExtAddressUSDC);

    const cometNewUSDS = new Contract(
      USDS_COMET,
      [
        'function assetList() external view returns (address)',
        'function extensionDelegate() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddressUSDS = await cometNewUSDS.assetList();

    expect(assetListAddressUSDS).to.not.be.equal(ethers.constants.AddressZero);
    expect(await cometNewUSDS.extensionDelegate()).to.be.equal(newCometExtAddressUSDS);

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
