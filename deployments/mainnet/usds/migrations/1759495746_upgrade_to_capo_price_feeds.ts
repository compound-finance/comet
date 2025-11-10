import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { Numeric } from '../../../../test/helpers';
export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const wstEthCapoPriceFeedAddress = '0xA2699232B341881B1Ed85d91592b7c259E029aCf';
const weETHCapoPriceFeedAddress = '0x4F12633d511dC3049DE1ea923b7047fBeD0070D2';

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETH_USD_SVR_PRICE_FEED = '0xc0053f3FBcCD593758258334Dfce24C2A9A673aD';
const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

let newWstETHPriceFeed: string;
let oldWstETHPriceFeed: string;

let newWeEthPriceFeed: string;
let oldWeEthPriceFeed: string;

let oldWETHPriceFeed: string;

export default migration('1759495746_upgrade_to_capo_price_feeds', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWeEthPriceFeed = weETHCapoPriceFeedAddress;

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
        args: [comet.address, WETH_ADDRESS, ETH_USD_SVR_PRICE_FEED],
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

    const description = `# Update price feeds in cUSDSv3 on Mainnet with CAPO and Chainlink SVR implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH, WETH and weETH on the USDS market on Mainnet.

### SVR summary

[RFP process](https://www.comp.xyz/t/oev-rfp-process-update-july-2025/6945) and community [vote](https://snapshot.box/#/s:comp-vote.eth/proposal/0x98a3873319cdb5a4c66b6f862752bdcfb40d443a5b9c2f9472188d7ed5f9f2e0) passed and decided to implement Chainlink's SVR solution for Mainnet markets, this proposal updates wstETH, WETH and weETH price feeds to support SVR implementations.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH and weETH price feeds are updated to their CAPO implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1032),  [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

## CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631), as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates wstETH price feed.
The second action updates WETH price feed.
The third action updates weETH price feed.
The fourth action deploys and upgrades Comet to a new version.
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
    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 35e8);

    // 2. WETH
    const wethIndexInComet = await configurator.getAssetIndex(comet.address, WETH_ADDRESS);
    const wethInCometInfo = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    const wethInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wethIndexInComet];

    expect(wethInCometInfo.priceFeed).to.eq(ETH_USD_SVR_PRICE_FEED);
    expect(wethInConfiguratorInfoWETHComet.priceFeed).to.eq(ETH_USD_SVR_PRICE_FEED);
    expect(await comet.getPrice(ETH_USD_SVR_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 35e8);

    // 3. weETH
    const weETHIndexInComet = await configurator.getAssetIndex(comet.address, WEETH_ADDRESS);
    const weETHInCometInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    const weETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(newWeEthPriceFeed);
    expect(weETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthPriceFeed);
    expect(await comet.getPrice(newWeEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldWeEthPriceFeed), 35e8);
  },
});
