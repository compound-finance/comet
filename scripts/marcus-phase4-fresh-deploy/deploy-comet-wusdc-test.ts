// Step 0 verification — deploy a Comet with wUSDC (rome-solidity SPL_ERC20) as
// base asset, NOT UnifiedToken. Goal: bench direct supply/borrow CU and confirm
// vanilla Compound + wUSDC works without UT-specific machinery.
//
// Re-uses V2's CometProxyAdmin + usdcFeed for the substrate.
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/deploy-comet-wusdc-test.ts --network marcus

import { ethers } from 'hardhat';

const REUSE = {
  cometProxyAdmin: '0x9A293E9acFa12Ffe05428B2550E3C41b99d804bc', // V2
  usdcFeed:        '0x815B967F47e3c2173d87c1Ff23114C00BA6766E5', // V2 ($1.00)
};

const WUSDC = '0x39844f1d605a11acd87f766494291bbd11b406f4'; // rome-solidity SPL_ERC20

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Deployer: ${admin.address}`);
  console.log(`Base asset: wUSDC (${WUSDC})`);

  // 1. CometExt with wUSDC name/symbol
  const CometExt = await ethers.getContractFactory('contracts/CometExt.sol:CometExt');
  const extConfig = {
    name32:   ethers.utils.formatBytes32String('Compound wUSDC on Rome'),
    symbol32: ethers.utils.formatBytes32String('cwUSDCv3'),
  };
  console.log('\n[1/5] CometExt...');
  const cometExt = await CometExt.deploy(extConfig, { gasLimit: 100_000_000 });
  await cometExt.deployed();
  console.log(`      ${cometExt.address}`);

  // 2. Comet impl pointing at wUSDC
  console.log('\n[2/5] Comet impl (baseToken=wUSDC)...');
  const cometConfig = {
    governor: admin.address,
    pauseGuardian: admin.address,
    baseToken: WUSDC,                       // ← wUSDC, not UnifiedToken
    baseTokenPriceFeed: REUSE.usdcFeed,
    extensionDelegate: cometExt.address,
    supplyKink: ethers.BigNumber.from('850000000000000000'),
    supplyPerYearInterestRateSlopeLow:  ethers.BigNumber.from('48000000000000000'),
    supplyPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1600000000000000000'),
    supplyPerYearInterestRateBase: 0,
    borrowKink: ethers.BigNumber.from('850000000000000000'),
    borrowPerYearInterestRateSlopeLow:  ethers.BigNumber.from('53000000000000000'),
    borrowPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1700000000000000000'),
    borrowPerYearInterestRateBase: ethers.BigNumber.from('15000000000000000'),
    storeFrontPriceFactor: ethers.BigNumber.from('500000000000000000'),
    trackingIndexScale: ethers.BigNumber.from('1000000000000000'),
    baseTrackingSupplySpeed: 0,
    baseTrackingBorrowSpeed: 0,
    baseMinForRewards: ethers.BigNumber.from('100').mul(1_000_000),
    baseBorrowMin: 1,
    targetReserves: ethers.BigNumber.from('5000000').mul(1_000_000),
    assetConfigs: [],
  };
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await Comet.deploy(cometConfig, { gasLimit: 500_000_000 });
  await cometImpl.deployed();
  console.log(`      ${cometImpl.address}`);

  // 3. Configurator + ConfiguratorProxy
  console.log('\n[3/5] Configurator...');
  const Configurator = await ethers.getContractFactory('contracts/Configurator.sol:Configurator');
  const configuratorImpl = await Configurator.deploy({ gasLimit: 200_000_000 });
  await configuratorImpl.deployed();
  console.log(`      Configurator impl:  ${configuratorImpl.address}`);

  const ConfiguratorProxy = await ethers.getContractFactory('contracts/ConfiguratorProxy.sol:ConfiguratorProxy');
  const initData = configuratorImpl.interface.encodeFunctionData('initialize', [admin.address]);
  const configuratorProxy = await ConfiguratorProxy.deploy(
    configuratorImpl.address,
    REUSE.cometProxyAdmin,
    initData,
    { gasLimit: 100_000_000 },
  );
  await configuratorProxy.deployed();
  console.log(`      ConfiguratorProxy:  ${configuratorProxy.address}`);

  // 4. CometProxy (TransparentUpgradeableProxy)
  console.log('\n[4/5] CometProxy...');
  const TransparentUpgradeableProxy = await ethers.getContractFactory(
    'contracts/vendor/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
  );
  const cometProxy = await TransparentUpgradeableProxy.deploy(
    cometImpl.address,
    REUSE.cometProxyAdmin,
    '0x',
    { gasLimit: 100_000_000 },
  );
  await cometProxy.deployed();
  console.log(`      CometProxy:         ${cometProxy.address}`);

  // 5. initializeStorage on the comet
  console.log('\n[5/5] cometProxy.initializeStorage()...');
  const initTx = await Comet.attach(cometProxy.address).initializeStorage({ gasLimit: 30_000_000 });
  await initTx.wait();
  console.log(`      tx: ${initTx.hash}`);

  console.log('\n══════ Comet-wUSDC test deploy COMPLETE ══════');
  console.log(`  cometProxy:    ${cometProxy.address}`);
  console.log(`  cometImpl:     ${cometImpl.address}`);
  console.log(`  cometExt:      ${cometExt.address}`);
  console.log(`  config admin:  ${configuratorProxy.address}`);
  console.log(`  baseToken:     wUSDC ${WUSDC}`);
}

main().catch(e => { console.error(e); process.exit(1); });
