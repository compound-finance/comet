import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const wstEthCapoPriceFeedAddress = '0xA2699232B341881B1Ed85d91592b7c259E029aCf';
const WBTCPriceFeedAddress = '0xc8E4c3F58d5FC4409522503927Ecea057EbbA1fc';
const weETHCapoPriceFeedAddress = '0x4F12633d511dC3049DE1ea923b7047fBeD0070D2';

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETH_USD_SVR_PRICE_FEED = '0xc0053f3FBcCD593758258334Dfce24C2A9A673aD';

const WBTC_ADDRESS = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';

const LINK_ADDRESS = '0x514910771af9ca656af840dff83e8264ecf986ca';
const LINK_USD_SVR_PRICE_FEED_ADDRESS = '0x83B34662f65532e611A87EBed38063Dec889D5A7';

const RSETH_ADDRESS = '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7';
const RSETH_TO_ETH_PRICE_FEED = '0x9d2F2f96B24C444ee32E57c04F7d944bcb8c8549';

const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';

const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

const COMP_ADDRESS = '0xc00e94Cb662C3520282E6f5717214004A7f26888';
const COMP_USD_SVR_PRICE_FEED = '0x69B50fF403E995d9c4441a303438D9049dAC8cCD';

const FEED_DECIMALS = 8;
const blockToFetch = 23397862;

let newWstETHPriceFeed: string;
let oldWstETHPriceFeed: string;

let newWbtcPriceFeed: string;
let oldWbtcPriceFeed: string;

let newRsEthPriceFeed: string;
let oldRsEthPriceFeed: string;

let oldWETHPriceFeed: string;
let oldLinkPriceFeed: string;

let newWeEthPriceFeed: string;
let oldWeEthPriceFeed: string;

let oldCOMPPriceFeed: string;

export default migration('1759236467_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();

    const rsEthRateProvider = await deploymentManager.existing('rsETH:_priceFeed', RSETH_TO_ETH_PRICE_FEED, 'mainnet', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioRsEth] = await rsEthRateProvider.latestRoundData({ blockTag: blockToFetch });
    const blockToFetchTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))!.timestamp;
    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_SVR_PRICE_FEED,
        rsEthRateProvider.address,
        'rsETH / USD CAPO SVR Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRsEth,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0554, 4)
        }
      ],
      true
    );

    return {
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    rsEthCapoPriceFeedAddress,
  }) {

    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWbtcPriceFeed = WBTCPriceFeedAddress;
    newRsEthPriceFeed = rsEthCapoPriceFeedAddress;
    newWeEthPriceFeed = weETHCapoPriceFeedAddress;

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
    [,, oldWeEthPriceFeed] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    [,, oldCOMPPriceFeed] = await comet.getAssetInfoByAddress(COMP_ADDRESS);
    [,, oldRsEthPriceFeed] = await comet.getAssetInfoByAddress(RSETH_ADDRESS);

    const mainnetActions = [
      // 1. Update wstETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WSTETH_ADDRESS, wstEthCapoPriceFeedAddress],
      },
      // 2. Update WBTC price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WBTC_ADDRESS, WBTCPriceFeedAddress],
      },
      // 3. Update WETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WETH_ADDRESS, ETH_USD_SVR_PRICE_FEED],
      },
      // 4. Update LINK price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, LINK_ADDRESS, LINK_USD_SVR_PRICE_FEED_ADDRESS],
      },
      // 5. Update rsETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, RSETH_ADDRESS, rsEthCapoPriceFeedAddress],
      },
      // 6. Update weETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WEETH_ADDRESS, weETHCapoPriceFeedAddress],
      },
      // 7. Update COMP price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, COMP_ADDRESS, COMP_USD_SVR_PRICE_FEED],
      },
      // 8. Deploy and upgrade Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Update price feeds in cUSDCv3 on Mainnet with CAPO and Chainlink SVR implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH, WBTC, WETH, LINK, rsETH, weETH and COMP on the USDC market on Mainnet.

### SVR summary

[RFP process](https://www.comp.xyz/t/oev-rfp-process-update-july-2025/6945) and community [vote](https://snapshot.box/#/s:comp-vote.eth/proposal/0x98a3873319cdb5a4c66b6f862752bdcfb40d443a5b9c2f9472188d7ed5f9f2e0) passed and decided to implement Chainlink's SVR solution for Mainnet markets, this proposal updates wstETH, WETH, WBTC, LINK, rsETH, weETH and COMP price feeds to support SVR implementations.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH, rsETH and weETH price feeds are updated to their CAPO implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1031),  [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

## CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631), as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates wstETH price feed.
The second action updates WBTC price feed.
The third action updates WETH price feed.
The fourth action updates LINK price feed.
The fifth action updates rsETH price feed.
The sixth action updates weETH price feed.
The seventh action updates COMP price feed.
The eighth action deploys and upgrades Comet to a new version.
`;

 
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );
 
    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    // 1. wstETH
    const wstETHIndexInComet = await configurator.getAssetIndex(comet.address, WSTETH_ADDRESS);
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHPriceFeed);
    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 18e8);

    // 2. WBTC
    const wBTCIndexInComet = await configurator.getAssetIndex(comet.address, WBTC_ADDRESS);
    const wBTCInCometInfo = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    const wBTCInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wBTCIndexInComet]; 

    expect(wBTCInCometInfo.priceFeed).to.eq(newWbtcPriceFeed);
    expect(wBTCInConfiguratorInfoWETHComet.priceFeed).to.eq(newWbtcPriceFeed);
    expect(await comet.getPrice(newWbtcPriceFeed)).to.be.closeTo(await comet.getPrice(oldWbtcPriceFeed), 5e10);

    // 3. WETH
    const WETHIndexInComet = await configurator.getAssetIndex(comet.address, WETH_ADDRESS);
    const WETHInCometInfo = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    const WETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[WETHIndexInComet];

    expect(WETHInCometInfo.priceFeed).to.eq(ETH_USD_SVR_PRICE_FEED);
    expect(WETHInConfiguratorInfoWETHComet.priceFeed).to.eq(ETH_USD_SVR_PRICE_FEED);
    expect(await comet.getPrice(ETH_USD_SVR_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 18e8);

    // 4. LINK
    const linkIndexInComet = await configurator.getAssetIndex(comet.address, LINK_ADDRESS);
    const linkInCometInfo = await comet.getAssetInfoByAddress(LINK_ADDRESS);
    const linkInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[linkIndexInComet]; 

    expect(linkInCometInfo.priceFeed).to.eq(LINK_USD_SVR_PRICE_FEED_ADDRESS);
    expect(linkInConfiguratorInfoWETHComet.priceFeed).to.eq(LINK_USD_SVR_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(LINK_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldLinkPriceFeed), 3e7);

    // 5. rsETH
    const rsEthIndexInComet = await configurator.getAssetIndex(comet.address, RSETH_ADDRESS);
    const rsEthInCometInfo = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    const rsEthInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[rsEthIndexInComet];

    expect(rsEthInCometInfo.priceFeed).to.eq(newRsEthPriceFeed);
    expect(rsEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newRsEthPriceFeed);
    expect(await comet.getPrice(newRsEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldRsEthPriceFeed), 18e8);

    // 6. weETH
    const weETHIndexInComet = await configurator.getAssetIndex(comet.address, WEETH_ADDRESS);
    const weETHInCometInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    const weETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(newWeEthPriceFeed);
    expect(weETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthPriceFeed);
    expect(await comet.getPrice(newWeEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldWeEthPriceFeed), 18e8);

    // 7. COMP
    const compIndexInComet = await configurator.getAssetIndex(comet.address, COMP_ADDRESS);
    const compInCometInfo = await comet.getAssetInfoByAddress(COMP_ADDRESS);
    const compInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[compIndexInComet];

    expect(compInCometInfo.priceFeed).to.eq(COMP_USD_SVR_PRICE_FEED);
    expect(compInConfiguratorInfoWETHComet.priceFeed).to.eq(COMP_USD_SVR_PRICE_FEED);
    expect(await comet.getPrice(COMP_USD_SVR_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldCOMPPriceFeed), 1e8);
  },
});
