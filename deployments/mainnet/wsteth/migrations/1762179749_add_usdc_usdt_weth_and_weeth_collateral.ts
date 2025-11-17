import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

const WSTETH_TO_ETH_CAPO_PRICE_FEED = '0x5372Bcf3486D59C23F5fC85745B41F180EFFf881';
const WEETH_TO_ETH_CAPO_PRICE_FEED = '0x3cB8348cd79C98e3D370527425d56EFF3b5728Fd';
const USDC_TO_ETH_PRICE_FEED = '0x986b5E1e1755e3C2440e960477f25201B0a8bbD4';
const USDT_TO_ETH_PRICE_FEED = '0xEe9F2375b4bdF6387aa8265dD4FB8F16512A1d46';
const CONSTANT_PRICE_FEED_ADDRESS = '0x72e9B6F907365d76C6192aD49C0C5ba356b7Fa48';

let newPriceFeedUSDCAddress: string;
let newPriceFeedUSDTAddress: string;
let newPriceFeedWETHAddress: string;
let newPriceFeedWEETHAddress: string;

export default migration('1762179749_add_usdc_usdt_weth_and_weeth_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        USDC_TO_ETH_PRICE_FEED,        // USDC / ETH price feed
        WSTETH_TO_ETH_CAPO_PRICE_FEED, // WSTETH / ETH price feed (reversed to get ETH / WSTETH)
        8,                             // decimals
        'USDC / wstETH price feed',    // description
      ],
      true
    );

    const usdtPriceFeed = await deploymentManager.deploy(
      'USDT:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        USDT_TO_ETH_PRICE_FEED,        // USDT / ETH price feed
        WSTETH_TO_ETH_CAPO_PRICE_FEED, // WSTETH / ETH price feed (reversed to get ETH / WSTETH)
        8,                             // decimals
        'USDT / wstETH price feed',    // description
      ],
      true
    );

    const wethPriceFeed =  await deploymentManager.deploy(
      'WETH:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        CONSTANT_PRICE_FEED_ADDRESS,   // WETH / ETH price feed (constant 1:1)
        WSTETH_TO_ETH_CAPO_PRICE_FEED, // WSTETH / ETH price feed (reversed to get ETH / WSTETH)
        8,                             // decimals
        'WETH / wstETH price feed',    // description
      ],
      true
    );

    const weethPriceFeed =  await deploymentManager.deploy(
      'weETH:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        WEETH_TO_ETH_CAPO_PRICE_FEED,  // weETH / ETH price feed
        WSTETH_TO_ETH_CAPO_PRICE_FEED, // WSTETH / ETH price feed (reversed to get ETH / WSTETH)
        8,                             // decimals
        'weETH / wstETH price feed',   // description
      ],
      true
    );

    return {
      usdcPriceFeedAddress: usdcPriceFeed.address,
      usdtPriceFeedAddress: usdtPriceFeed.address,
      wethPriceFeedAddress: wethPriceFeed.address,
      weethPriceFeedAddress: weethPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    usdcPriceFeedAddress,
    usdtPriceFeedAddress,
    wethPriceFeedAddress,
    weethPriceFeedAddress
  }) {

    const trace = deploymentManager.tracer();

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdcPriceFeed = await deploymentManager.existing(
      'USDC:priceFeed',
      usdcPriceFeedAddress,
      'mainnet'
    );

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdtPriceFeed = await deploymentManager.existing(
      'USDT:priceFeed',
      usdtPriceFeedAddress,
      'mainnet'
    );

    const WETH = await deploymentManager.existing(
      'WETH',
      WETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const wethPriceFeed = await deploymentManager.existing(
      'WETH:priceFeed',
      wethPriceFeedAddress,
      'mainnet'
    );

    const WEETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const weethPriceFeed = await deploymentManager.existing(
      'weETH:priceFeed',
      weethPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedUSDCAddress = usdcPriceFeedAddress;
    newPriceFeedUSDTAddress = usdtPriceFeedAddress;
    newPriceFeedWETHAddress = wethPriceFeedAddress;
    newPriceFeedWEETHAddress = weethPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: usdcPriceFeed.address,
      decimals: await USDC.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.83, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(10_000_000, 6),
    };

    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: usdtPriceFeed.address,
      decimals: await USDT.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.83, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(15_000_000, 6),
    };

    const wethAssetConfig = {
      asset: WETH.address,
      priceFeed: wethPriceFeed.address,
      decimals: await WETH.decimals(),
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(100_000, 18),
    };

    const weethAssetConfig = {
      asset: WEETH.address,
      priceFeed: weethPriceFeed.address,
      decimals: await WEETH.decimals(),
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(10_000, 18),
    };

    const mainnetActions = [
      // 1. Add USDC as collateral
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, usdcAssetConfig],
      },
      // 2. Add USDT as collateral
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, usdtAssetConfig],
      },
      // 3. Add WETH as collateral
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, wethAssetConfig],
      },
      // 4. Add weETH as collateral
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, weethAssetConfig],
      },
      // 5. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Add USDC, USDT, WETH and weETH as collaterals into cWstETHv3 on Mainnet

## Proposal summary

WOOF proposes to add USDC, USDT, WETH and weETH into cWstETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III wstETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-weth-weeth-usdc-and-usdt-risk-recommendations-for-mainnet-wsteth/7318/1).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1058) and [forum discussion](https://www.comp.xyz/t/gauntlet-weth-weeth-usdc-and-usdt-risk-recommendations-for-mainnet-wsteth/7318).


## Proposal Actions

The first action adds USDC asset as collateral with corresponding configurations.

The second action adds USDT asset as collateral with corresponding configurations.

The third action adds WETH asset as collateral with corresponding configurations.

The fourth action adds weETH asset as collateral with corresponding configurations.

The fifth action upgrades Comet to a new version.`;

    const [targets, values, calldatas, ] = await proposal(mainnetActions, description);
    const signer = await deploymentManager.getSigner();
    const txn = await (await governor.connect(signer).propose(targets, values, calldatas, description)).wait();

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    // 1. Compare USDC asset config with Comet and Configurator asset info
    const usdcAssetIndex = Number(await comet.numAssets()) - 4;

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: newPriceFeedUSDCAddress,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.83, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(10_000_000, 6),
    };

    const cometUSDCAssetInfo = await comet.getAssetInfoByAddress(USDC_ADDRESS);
    expect(usdcAssetIndex).to.be.equal(cometUSDCAssetInfo.offset);
    expect(usdcAssetConfig.asset).to.be.equal(cometUSDCAssetInfo.asset);
    expect(usdcAssetConfig.priceFeed).to.be.equal(cometUSDCAssetInfo.priceFeed);
    expect(exp(1, usdcAssetConfig.decimals)).to.be.equal(cometUSDCAssetInfo.scale);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(cometUSDCAssetInfo.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(cometUSDCAssetInfo.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(cometUSDCAssetInfo.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(cometUSDCAssetInfo.supplyCap);

    const configuratorUSDCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdcAssetIndex];
    expect(usdcAssetConfig.asset).to.be.equal(configuratorUSDCAssetConfig.asset);
    expect(usdcAssetConfig.priceFeed).to.be.equal(configuratorUSDCAssetConfig.priceFeed);
    expect(usdcAssetConfig.decimals).to.be.equal(configuratorUSDCAssetConfig.decimals);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUSDCAssetConfig.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUSDCAssetConfig.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(configuratorUSDCAssetConfig.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(configuratorUSDCAssetConfig.supplyCap);

    // 2. Compare USDT asset config with Comet and Configurator asset info
    const usdtAssetIndex = Number(await comet.numAssets()) - 3;

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: newPriceFeedUSDTAddress,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.83, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(15_000_000, 6),
    };

    const cometUSDTAssetInfo = await comet.getAssetInfoByAddress(USDT_ADDRESS);
    expect(usdtAssetIndex).to.be.equal(cometUSDTAssetInfo.offset);
    expect(usdtAssetConfig.asset).to.be.equal(cometUSDTAssetInfo.asset);
    expect(usdtAssetConfig.priceFeed).to.be.equal(cometUSDTAssetInfo.priceFeed);
    expect(exp(1, usdtAssetConfig.decimals)).to.be.equal(cometUSDTAssetInfo.scale);
    expect(usdtAssetConfig.borrowCollateralFactor).to.be.equal(cometUSDTAssetInfo.borrowCollateralFactor);
    expect(usdtAssetConfig.liquidateCollateralFactor).to.be.equal(cometUSDTAssetInfo.liquidateCollateralFactor);
    expect(usdtAssetConfig.liquidationFactor).to.be.equal(cometUSDTAssetInfo.liquidationFactor);
    expect(usdtAssetConfig.supplyCap).to.be.equal(cometUSDTAssetInfo.supplyCap);

    const configuratorUSDTAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdtAssetIndex];
    expect(usdtAssetConfig.asset).to.be.equal(configuratorUSDTAssetConfig.asset);
    expect(usdtAssetConfig.priceFeed).to.be.equal(configuratorUSDTAssetConfig.priceFeed);
    expect(usdtAssetConfig.decimals).to.be.equal(configuratorUSDTAssetConfig.decimals);
    expect(usdtAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUSDTAssetConfig.borrowCollateralFactor);
    expect(usdtAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUSDTAssetConfig.liquidateCollateralFactor);
    expect(usdtAssetConfig.liquidationFactor).to.be.equal(configuratorUSDTAssetConfig.liquidationFactor);
    expect(usdtAssetConfig.supplyCap).to.be.equal(configuratorUSDTAssetConfig.supplyCap);

    // 3. Compare WETH asset config with Comet and Configurator asset info
    const wethAssetIndex = Number(await comet.numAssets()) - 2;

    const WETH = await deploymentManager.existing(
      'WETH',
      WETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const wethAssetConfig = {
      asset: WETH.address,
      priceFeed: newPriceFeedWETHAddress,
      decimals: 18n,
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(100_000, 18),
    };

    const cometWETHAssetInfo = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    expect(wethAssetIndex).to.be.equal(cometWETHAssetInfo.offset);
    expect(wethAssetConfig.asset).to.be.equal(cometWETHAssetInfo.asset);
    expect(wethAssetConfig.priceFeed).to.be.equal(cometWETHAssetInfo.priceFeed);
    expect(exp(1, wethAssetConfig.decimals)).to.be.equal(cometWETHAssetInfo.scale);
    expect(wethAssetConfig.borrowCollateralFactor).to.be.equal(cometWETHAssetInfo.borrowCollateralFactor);
    expect(wethAssetConfig.liquidateCollateralFactor).to.be.equal(cometWETHAssetInfo.liquidateCollateralFactor);
    expect(wethAssetConfig.liquidationFactor).to.be.equal(cometWETHAssetInfo.liquidationFactor);
    expect(wethAssetConfig.supplyCap).to.be.equal(cometWETHAssetInfo.supplyCap);

    const configuratorWETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wethAssetIndex];
    expect(wethAssetConfig.asset).to.be.equal(configuratorWETHAssetConfig.asset);
    expect(wethAssetConfig.priceFeed).to.be.equal(configuratorWETHAssetConfig.priceFeed);
    expect(wethAssetConfig.decimals).to.be.equal(configuratorWETHAssetConfig.decimals);
    expect(wethAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWETHAssetConfig.borrowCollateralFactor);
    expect(wethAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWETHAssetConfig.liquidateCollateralFactor);
    expect(wethAssetConfig.liquidationFactor).to.be.equal(configuratorWETHAssetConfig.liquidationFactor);
    expect(wethAssetConfig.supplyCap).to.be.equal(configuratorWETHAssetConfig.supplyCap);

    // 4. Compare weETH asset config with Comet and Configurator asset info
    const weethAssetIndex = Number(await comet.numAssets()) - 1;

    const WEETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const weethAssetConfig = {
      asset: WEETH.address,
      priceFeed: newPriceFeedWEETHAddress,
      decimals: 18n,
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(10_000, 18),
    };

    const cometWEETHAssetInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    expect(weethAssetIndex).to.be.equal(cometWEETHAssetInfo.offset);
    expect(weethAssetConfig.asset).to.be.equal(cometWEETHAssetInfo.asset);
    expect(weethAssetConfig.priceFeed).to.be.equal(cometWEETHAssetInfo.priceFeed);
    expect(exp(1, weethAssetConfig.decimals)).to.be.equal(cometWEETHAssetInfo.scale);
    expect(weethAssetConfig.borrowCollateralFactor).to.be.equal(cometWEETHAssetInfo.borrowCollateralFactor);
    expect(weethAssetConfig.liquidateCollateralFactor).to.be.equal(cometWEETHAssetInfo.liquidateCollateralFactor);
    expect(weethAssetConfig.liquidationFactor).to.be.equal(cometWEETHAssetInfo.liquidationFactor);
    expect(weethAssetConfig.supplyCap).to.be.equal(cometWEETHAssetInfo.supplyCap);

    const configuratorWEETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[weethAssetIndex];
    expect(weethAssetConfig.asset).to.be.equal(configuratorWEETHAssetConfig.asset);
    expect(weethAssetConfig.priceFeed).to.be.equal(configuratorWEETHAssetConfig.priceFeed);
    expect(weethAssetConfig.decimals).to.be.equal(configuratorWEETHAssetConfig.decimals);
    expect(weethAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWEETHAssetConfig.borrowCollateralFactor);
    expect(weethAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWEETHAssetConfig.liquidateCollateralFactor);
    expect(weethAssetConfig.liquidationFactor).to.be.equal(configuratorWEETHAssetConfig.liquidationFactor);
    expect(weethAssetConfig.supplyCap).to.be.equal(configuratorWEETHAssetConfig.supplyCap);
  },
});