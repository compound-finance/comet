import { expect } from 'chai';
import { ethers } from 'hardhat';
import { setupFork, impersonateAccount, setBalance, SnapshotRestorer, takeSnapshot} from '../helpers';
import {
  CometExtAssetList__factory,
  CometFactoryWithExtendedAssetList__factory,
  CometProxyAdmin,
  CometWithExtendedAssetList,
  Configurator,
  CometExtAssetList,
} from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { TotalsBasicStructOutput } from 'build/types/CometExtAssetList';

describe('extended pause upgrade test', function () {
  // Constants
  const FORK_BLOCK_NUMBER = 23655019;
  const COMET_ADDRESS = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
  const CONFIGURATOR_ADDRESS = '0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3';
  const GOVERNOR_ADDRESS = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';
  const ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

  // Contracts
  let comet: CometWithExtendedAssetList;
  let cometExt: CometExtAssetList;
  let configurator: Configurator;
  let proxyAdmin: CometProxyAdmin;
  let newCometExt: CometExtAssetList;

  // Signers
  let governor: SignerWithAddress;
  let pauseGuardian: SignerWithAddress;

  // Variables
  let assetListFactoryAddress: string;
  let name32: string;
  let symbol32: string;
  let originalImpl: string;
  let newImpl: string;

  // Extension delegate storage snapshot
  let assetListFactoryBefore: string;
  let maxAssetsBefore: number;
  let versionBefore: string;
  let nameBefore: string;
  let symbolBefore: string;
  let baseAccrualScaleBefore: BigNumber;
  let baseIndexScaleBefore: BigNumber;
  let factorScaleBefore: BigNumber;
  let priceScaleBefore: BigNumber;

  // Immutable or constants snapshot
  let governorBefore: string;
  let pauseGuardianBefore: string;
  let baseTokenBefore: string;
  let baseTokenPriceFeedBefore: string;
  let supplyKinkBefore: BigNumber;

  // Totals basic snapshot
  let totalsBasicBefore: TotalsBasicStructOutput;

  // Upgrade transaction
  let upgradeTx: ContractTransaction;

  // Snapshot
  let snapshot: SnapshotRestorer;

  before(async function () {
    // Setup mainnet fork
    await setupFork(FORK_BLOCK_NUMBER);

    // Get contracts
    comet = (await ethers.getContractAt(
      'CometWithExtendedAssetList',
      COMET_ADDRESS
    )) as CometWithExtendedAssetList;

    configurator = (await ethers.getContractAt(
      'Configurator',
      CONFIGURATOR_ADDRESS
    )) as Configurator;

    // Get proxy admin
    const adminAddress = await ethers.provider.getStorageAt(
      COMET_ADDRESS,
      ADMIN_SLOT
    );
    const proxyAdminAddress = ethers.utils.getAddress(
      '0x' + adminAddress.slice(26)
    );
    proxyAdmin = (await ethers.getContractAt(
      'CometProxyAdmin',
      proxyAdminAddress
    )) as CometProxyAdmin;

    // Impersonate governor
    await impersonateAccount(GOVERNOR_ADDRESS);
    governor = await ethers.getSigner(GOVERNOR_ADDRESS);
    await setBalance(GOVERNOR_ADDRESS, ethers.utils.parseEther('10000'));

    // Get current extension delegate and its assetListFactory
    const currentExtensionDelegate = await comet.extensionDelegate();
    const CometExtAssetListInterface = await ethers.getContractAt(
      'IAssetListFactoryHolder',
      currentExtensionDelegate
    );
    assetListFactoryAddress =
      await CometExtAssetListInterface.assetListFactory();

    // Get name and symbol from current extension delegate
    const ExtInterface = await ethers.getContractAt(
      'CometExtInterface',
      currentExtensionDelegate
    );
    name32 = ethers.utils.formatBytes32String(await ExtInterface.name());
    symbol32 = ethers.utils.formatBytes32String(await ExtInterface.symbol());

    // Get current implementation
    originalImpl = await proxyAdmin.getProxyImplementation(COMET_ADDRESS);

    // Deploy new version of CometExtAssetList (with extended pause functionality)
    const CometExtAssetList = (await ethers.getContractFactory(
      'CometExtAssetList'
    )) as CometExtAssetList__factory;
    newCometExt = await CometExtAssetList.deploy(
      { name32, symbol32 },
      assetListFactoryAddress
    );

    // Deploy CometFactoryWithExtendedAssetList
    const CometFactoryWithExtendedAssetList = (await ethers.getContractFactory(
      'CometFactoryWithExtendedAssetList'
    )) as CometFactoryWithExtendedAssetList__factory;
    const newFactory = await CometFactoryWithExtendedAssetList.deploy();

    // Step 1: Set the new extension delegate in configurator
    await configurator
      .connect(governor)
      .setExtensionDelegate(COMET_ADDRESS, newCometExt.address);

    // Step 2: Set the new factory in the configurator
    await configurator
      .connect(governor)
      .setFactory(COMET_ADDRESS, newFactory.address);

    // Deploy new implementation using configurator
    const deployTx = await configurator.connect(governor).deploy(COMET_ADDRESS);
    const deployReceipt = await deployTx.wait();
    const deployEvent = deployReceipt.events.find((e) => e.event === 'CometDeployed');
    newImpl = deployEvent.args.newComet;
    expect(newImpl).to.not.equal(ethers.constants.AddressZero);
    expect(newImpl).to.not.equal(originalImpl);

    cometExt = await ethers.getContractAt('CometExtAssetList', COMET_ADDRESS) as CometExtAssetList;

    // Extension delegate storage snapshot
    assetListFactoryBefore = await cometExt.assetListFactory();
    maxAssetsBefore = await cometExt.maxAssets();
    versionBefore = await cometExt.version();
    nameBefore = await cometExt.name();
    symbolBefore = await cometExt.symbol();
    baseAccrualScaleBefore = await cometExt.baseAccrualScale();
    baseIndexScaleBefore = await cometExt.baseIndexScale();
    factorScaleBefore = await cometExt.factorScale();
    priceScaleBefore = await cometExt.priceScale();

    // Immutable or constants snapshot
    governorBefore = await comet.governor();
    pauseGuardianBefore = await comet.pauseGuardian();
    baseTokenBefore = await comet.baseToken();
    baseTokenPriceFeedBefore = await comet.baseTokenPriceFeed();
    supplyKinkBefore = await comet.supplyKink();

    // Totals basic snapshot
    totalsBasicBefore = await cometExt.totalsBasic();

    // Impersonate governor
    await impersonateAccount(pauseGuardianBefore);
    pauseGuardian = await ethers.getSigner(pauseGuardianBefore);
    await setBalance(pauseGuardianBefore, ethers.utils.parseEther('10000'));

    upgradeTx = await proxyAdmin.connect(governor).upgrade(COMET_ADDRESS, newImpl);

    snapshot = await takeSnapshot();
  });

  it('should upgrade proxy to new implementation by governor', async function () {
    await upgradeTx.wait();
  });

  it('should update comet and comet extension delegate implementations', async function () {
    expect(await comet.extensionDelegate()).to.equal(newCometExt.address);
    expect(await proxyAdmin.getProxyImplementation(COMET_ADDRESS)).to.equal(newImpl);
  });

  it('should save comet extension storage safely after upgrade', async function () {
    expect(await cometExt.assetListFactory()).to.equal(assetListFactoryBefore);
    expect(await cometExt.maxAssets()).to.equal(maxAssetsBefore);
    expect(await cometExt.version()).to.equal(versionBefore);
    expect(await cometExt.name()).to.equal(nameBefore);
    expect(await cometExt.symbol()).to.equal(symbolBefore);
    expect(await cometExt.baseAccrualScale()).to.equal(baseAccrualScaleBefore);
    expect(await cometExt.baseIndexScale()).to.equal(baseIndexScaleBefore);
    expect(await cometExt.factorScale()).to.equal(factorScaleBefore);
    expect(await cometExt.priceScale()).to.equal(priceScaleBefore);
  });

  it('should save comet storage safely after upgrade', async function () {
    expect(await comet.governor()).to.equal(governorBefore);
    expect(await comet.pauseGuardian()).to.equal(pauseGuardianBefore);
    expect(await comet.baseToken()).to.equal(baseTokenBefore);
    expect(await comet.baseTokenPriceFeed()).to.equal(baseTokenPriceFeedBefore);
    expect(await comet.extensionDelegate()).to.equal(newCometExt.address);
    expect(await comet.supplyKink()).to.equal(supplyKinkBefore);
    expect(await cometExt.totalsBasic()).to.deep.equal(totalsBasicBefore);
  });

  it('should allow to call extended pause functions after upgrade', async function () {
    // Call extended pause functions
    await cometExt.connect(governor).pauseLendersWithdraw(true);
    await cometExt.connect(governor).pauseBorrowersWithdraw(true);
    await cometExt.connect(governor).pauseCollateralSupply(true);
    await cometExt.connect(governor).pauseBaseSupply(true);
    await cometExt.connect(governor).pauseCollateralAssetSupply(0, true);
    await cometExt.connect(governor).pauseLendersTransfer(true);
    await cometExt.connect(governor).pauseBorrowersTransfer(true);
    await cometExt.connect(governor).pauseCollateralTransfer(true);
    await cometExt.connect(governor).pauseCollateralAssetTransfer(0, true);
  });

  it('should update pause flags in comet storage', async function () {
    expect(await comet.isLendersWithdrawPaused()).to.be.true;
    expect(await comet.isBorrowersWithdrawPaused()).to.be.true;
    expect(await comet.isCollateralSupplyPaused()).to.be.true;
    expect(await comet.isBaseSupplyPaused()).to.be.true;
    expect(await comet.isCollateralAssetSupplyPaused(0)).to.be.true;
    expect(await comet.isLendersTransferPaused()).to.be.true;
    expect(await comet.isBorrowersTransferPaused()).to.be.true;
    expect(await comet.isCollateralTransferPaused()).to.be.true;
    expect(await comet.isCollateralAssetTransferPaused(0)).to.be.true;

    await snapshot.restore();
  });

  it('should allow to call deactivateCollateral function by pause guardian', async function () {
    await cometExt.connect(pauseGuardian).deactivateCollateral(0);
  });

  it('should set collateral as deactivated in comet', async function () {
    expect(await comet.isCollateralDeactivated(0)).to.be.true;
  });

  it('should update deactivated collaterals flag in comet storage', async function () {
    expect(await comet.deactivatedCollaterals()).to.equal(1);
  });

  it('should update pause flags for deactivated collateral', async function () {
    expect(await comet.isCollateralAssetSupplyPaused(0)).to.be.true;
    expect(await comet.isCollateralAssetTransferPaused(0)).to.be.true;
  });

  it('should allow to call activateCollateral function by governor', async function () {
    await cometExt.connect(governor).activateCollateral(0);
  });

  it('should set collateral as activated in comet', async function () {
    expect(await comet.isCollateralDeactivated(0)).to.be.false;
  });

  it('should update deactivated collaterals flag in comet storage', async function () {
    expect(await comet.deactivatedCollaterals()).to.equal(0);
  });

  it('should update pause flags for activated collateral', async function () {
    expect(await comet.isCollateralAssetSupplyPaused(0)).to.be.false;
    expect(await comet.isCollateralAssetTransferPaused(0)).to.be.false;
  });
});
