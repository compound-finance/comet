import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { Numeric } from '../../../../test/helpers';
import { IWstETH } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETH_USD_PRICE_FEED = '0x7c7FdFCa295a787ded12Bb5c1A49A8D2cC20E3F8';

const WBTC_ADDRESS = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const WBTC_BTC_PRICE_FEED_ADDRESS = '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23';
const BTC_USD_PRICE_FEED_ADDRESS = '0xdc715c751f1cc129A6b47fEDC87D9918a4580502';

const LINK_ADDRESS = '0x514910771af9ca656af840dff83e8264ecf986ca';
const LINK_USD_PRICE_FEED_ADDRESS = '0x64c67984A458513C6BAb23a815916B1b1075cf3a';

const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const FEED_DECIMALS = 8;

let newWstETHPriceFeed: string;
let oldWstETHPriceFeed: string;

let newWbtcPriceFeed: string;
let oldWbtcPriceFeed: string;

let newWETHPriceFeed: string;
let oldWETHPriceFeed: string;

let newLinkPriceFeed: string;
let oldLinkPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    const wstETH = await deploymentManager.existing('wstETH', WSTETH_ADDRESS, 'mainnet', 'contracts/IWstETH.sol:IWstETH') as IWstETH;
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'weth');
    const currentRatioWstEth = await wstETH.stEthPerToken();
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/WstETHCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        ETH_USD_PRICE_FEED,
        wstETH.address,
        constantPriceFeed.address,
        'wstETH:capoPriceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4)
        }
      ],
      true
    );

    const wbtcScalingPriceFeed = await deploymentManager.deploy(
      'WBTC:priceFeed',
      'pricefeeds/WBTCPriceFeed.sol',
      [
        WBTC_BTC_PRICE_FEED_ADDRESS,
        BTC_USD_PRICE_FEED_ADDRESS,
        8
      ]
    );

    const wETHPriceFeed = await deploymentManager.deploy(
      'WETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        ETH_USD_PRICE_FEED,
        8
      ],
      true
    );

    const linkPriceFeed = await deploymentManager.deploy(
      'LINK:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        LINK_USD_PRICE_FEED_ADDRESS,
        8
      ],
      true
    );

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      wETHPriceFeedAddress: wETHPriceFeed.address,
      wbtcPriceFeedAddress: wbtcScalingPriceFeed.address,
      linkPriceFeedAddress: linkPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    wstEthCapoPriceFeedAddress,
    wETHPriceFeedAddress,
    wbtcPriceFeedAddress,
    linkPriceFeedAddress
  }) {

    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWETHPriceFeed = wETHPriceFeedAddress;
    newWbtcPriceFeed = wbtcPriceFeedAddress;
    newLinkPriceFeed = linkPriceFeedAddress;

    const trace = deploymentManager.tracer();
 
    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldWbtcPriceFeed] = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    [,, oldLinkPriceFeed] = await comet.getAssetInfoByAddress(LINK_ADDRESS);

    const mainnetActions = [
      // 1. Update wstETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WSTETH_ADDRESS, wstEthCapoPriceFeedAddress],
      },
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WBTC_ADDRESS, wbtcPriceFeedAddress],
      },
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WETH_ADDRESS, wETHPriceFeedAddress],
      },
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, LINK_ADDRESS, linkPriceFeedAddress],
      },
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

    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 1e6);


    const wBTCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WBTC_ADDRESS
    );
    const wBTCInCometInfo = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    const wBTCInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wBTCIndexInComet]; 

    expect(wBTCInCometInfo.priceFeed).to.eq(newWbtcPriceFeed);
    expect(wBTCInConfiguratorInfoWETHComet.priceFeed).to.eq(newWbtcPriceFeed);

    expect(await comet.getPrice(newWbtcPriceFeed)).to.be.closeTo(await comet.getPrice(oldWbtcPriceFeed), 1e7);


    const wETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH_ADDRESS
    );
    const wETHInCometInfo = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    const wETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wETHIndexInComet]; 

    expect(wETHInCometInfo.priceFeed).to.eq(newWETHPriceFeed);
    expect(wETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWETHPriceFeed);
    expect(await comet.getPrice(newWETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 1e6);

    const linkIndexInComet = await configurator.getAssetIndex(
      comet.address,
      LINK_ADDRESS
    );
    const linkInCometInfo = await comet.getAssetInfoByAddress(LINK_ADDRESS);
    const linkInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[linkIndexInComet]; 

    expect(linkInCometInfo.priceFeed).to.eq(newLinkPriceFeed);
    expect(linkInConfiguratorInfoWETHComet.priceFeed).to.eq(newLinkPriceFeed);
    expect(await comet.getPrice(newLinkPriceFeed)).to.be.closeTo(await comet.getPrice(oldLinkPriceFeed), 1e6);
  },
});
