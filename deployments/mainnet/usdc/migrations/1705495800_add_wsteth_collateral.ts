import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

interface Vars { wstETHUSDPriceFeedAddress: string };

// https://docs.lido.fi/deployed-contracts/#core-protocol
const WSTETH_MAINNET_ADDRESS: string = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'

// ETH/USD price feed
// ENS: eth-usd.data.eth
const ETH_USD_PRICEFEED: string = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'

// Gauntlet Initial Parameter Recommendations
// https://www.comp.xyz/t/temp-check-add-wsteth-as-a-collateral-on-base-eth-market-usdc-market-on-arbitrum-and-ethereum-mainnet/4867/12
const BORROW_COLLATERAL_FACTOR = exp(0.83, 18);
const LIQUIDATE_COLLATERAL_FACTOR = exp(0.88, 18);
const LIQUIDATION_FACTOR = exp(0.92, 18);
const SUPPLY_CAP = exp(40000, 18);

export default migration('1705495800_add_wsteth_collateral', {
  prepare: async (deploymentManager: DeploymentManager) => {
    // Deploy a composed price feed for wstETH
    // wstETH/USDC = wstETH/stETH Mainnet exchange rate adapter + ETH/USD
    //
    //! invariant: presumes 1:1 stETH/ETH
    //! as the Lido on Ethereum protocol has primary market for withdrawal redemptions
    //
    // similar to AAVE v3 approach:
    // https://governance.aave.com/t/bgd-operational-oracles-update/13213/9
    //
    // - https://etherscan.io/address/0x8B6851156023f4f5A66F68BEA80851c3D905Ac93#code
    // - https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Ethereum.sol#L150
    // can't be re-used here diverging by interface (latestAnswer vs latestRoundData)
    //
    const wstETHUSDPriceFeedAddress: Contract = await deploymentManager.deploy(
      'wstETHUSD:priceFeed',
      'pricefeeds/WstETHPriceFeed.sol',
      [
        ETH_USD_PRICEFEED,      // ETH/USD Chainlink price feed (ENS: eth-usd.data.eth)
        WSTETH_MAINNET_ADDRESS, // wstETH contract
        8                       // decimals
      ]
    );
    return { wstETHUSDPriceFeedAddress: wstETHUSDPriceFeedAddress.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();

    // wstETH token address
    // https://etherscan.io/address/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0
    const wstETH = await deploymentManager.existing('wstETH', WSTETH_MAINNET_ADDRESS);
    const wstETHUSDPriceFeed = await deploymentManager.existing('wstETHUSD:priceFeed', vars.wstETHUSDPriceFeedAddress);

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: wstETH.address,
      priceFeed: wstETHUSDPriceFeed.address,
      decimals: await wstETH.decimals(),
      borrowCollateralFactor: BORROW_COLLATERAL_FACTOR,
      liquidateCollateralFactor: LIQUIDATE_COLLATERAL_FACTOR,
      liquidationFactor: LIQUIDATION_FACTOR,
      supplyCap: SUPPLY_CAP,
    };

    const actions = [

      // 1. Call the add asset function on the configurator contract
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, newAssetConfig],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },

    ];
    const description = '# Add wstETH as Collateral to cUSDCv3 Mainnet\nSee the proposal and parameter recommendations here: https://www.comp.xyz/t/temp-check-add-wsteth-as-a-collateral-on-base-eth-market-usdc-market-on-arbitrum-and-ethereum-mainnet/4867';
    const txn = await deploymentManager.retry(
      async () => governor.propose(...await proposal(actions, description))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      wstETH,
      'wstETHUSD:priceFeed': wstETHUSDPriceFeed
    } = await deploymentManager.getContracts();

    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);

    // check pricefeed
    expect(await wstETHInfo.priceFeed).to.be.eq(wstETHUSDPriceFeed.address);
    expect(await wstETHUSDPriceFeed.decimals()).to.be.eq(8);

    // check price composition
    const ethUSDPriceFeed = await deploymentManager.existing('ETHUSDPriceFeed', ETH_USD_PRICEFEED);
    const { r_, ethUSDPrice, s_, u_, a_ } = await ethUSDPriceFeed.latestRoundData();
    const { r__, wstETHUSDPrice, s__, u__, a__ } = await wstETHUSDPriceFeed.latestRoundData();
    const wstETHPerStETH = BigInt(await wstETH.tokensPerStEth());

    expect(BigInt(wstETHUSDPrice)).to.be.eq(BigInt(ethUSDPrice) * exp(10, 18) / wstETHPerStETH);

    // check config
    expect(await wstETHInfo.borrowCollateralFactor).to.be.eq(BORROW_COLLATERAL_FACTOR);
    expect(await wstETHInfo.liquidateCollateralFactor).to.be.eq(LIQUIDATE_COLLATERAL_FACTOR);
    expect(await wstETHInfo.liquidationFactor).to.be.eq(LIQUIDATION_FACTOR);
    expect(await wstETHInfo.supplyCap).to.be.eq(SUPPLY_CAP);
  },
});
