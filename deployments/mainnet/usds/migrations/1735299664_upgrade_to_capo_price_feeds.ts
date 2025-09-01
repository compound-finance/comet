import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { Numeric } from '../../../../test/helpers';
import { IWstETH, IRateProvider } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETH_USD_OEV_PRICE_FEED = '0x7c7FdFCa295a787ded12Bb5c1A49A8D2cC20E3F8';
const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';
const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;

let newWstETHPriceFeed: string;
let oldWstETHPriceFeed: string;

let newWeEthPriceFeed: string;
let oldWeEthPriceFeed: string;

let oldWETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    const wstETH = await deploymentManager.existing('wstETH', WSTETH_ADDRESS, 'base', 'contracts/IWstETH.sol:IWstETH') as IWstETH;
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'weth');
    const currentRatioWstEth = await wstETH.stEthPerToken();
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/WstETHCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_OEV_PRICE_FEED,
        wstETH.address,
        constantPriceFeed.address,
        'wstETH / USD capo price feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4) // 4.04%
        }
      ],
      true
    );

    const rateProviderWeETH = await deploymentManager.existing('weETH:_rateProvider', WEETH_ADDRESS, 'mainnet', 'contracts/capo/contracts/interfaces/IRateProvider.sol:IRateProvider') as IRateProvider;

    const currentRatioWeETH = await rateProviderWeETH.getRate();
    const weETHCapoPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'capo/contracts/RateBasedCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        WEETH_ADDRESS,
        ETH_USD_OEV_PRICE_FEED,
        'weETH / ETH capo price feed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioWeETH,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0323, 4) // 3.23%
        }
      ],
      true
    );
    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      weEthPriceFeedAddress: weETHCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    wstEthCapoPriceFeedAddress,
    weEthPriceFeedAddress
  }) {

    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWeEthPriceFeed = weEthPriceFeedAddress;

    const trace = deploymentManager.tracer();
 
    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    [,, oldWeEthPriceFeed] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);

    const mainnetActions = [
      // 1. Update wstETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WSTETH_ADDRESS, wstEthCapoPriceFeedAddress],
      },
      // 2. Update WETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WETH_ADDRESS, ETH_USD_OEV_PRICE_FEED],
      },
      // 3. Update weETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WEETH_ADDRESS, newWeEthPriceFeed],
      },
      // 4. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];
 
    const description = '';
 
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
    const { comet, configurator } = await deploymentManager.getContracts();
                
    const wstETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WSTETH_ADDRESS
    );
    
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    ); 
    
    const wstETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];
    
    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHPriceFeed);

    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 40e8);

    const wethIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH_ADDRESS
    );

    const wethInCometInfo = await comet.getAssetInfoByAddress(
      WETH_ADDRESS
    );

    const wethInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wethIndexInComet];

    expect(wethInCometInfo.priceFeed).to.eq(ETH_USD_OEV_PRICE_FEED);
    expect(wethInConfiguratorInfoWETHComet.priceFeed).to.eq(ETH_USD_OEV_PRICE_FEED);

    expect(await comet.getPrice(ETH_USD_OEV_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 40e8);

    const weETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );

    const weETHInCometInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );

    const weETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(newWeEthPriceFeed);
    expect(weETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthPriceFeed);

    expect(await comet.getPrice(newWeEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldWeEthPriceFeed), 40e8);
  },
});
