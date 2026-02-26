import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal, exp } from '../../../../src/deploy';
import { AggregatorV3Interface } from '../../../../build/types';
import { utils } from 'ethers';

const CBETHETH_USD_SVR_PRICE_FEED_ADDRESS = '0x0866Fc8a76BfC485B8E8C7D543A54bd72F015b1C';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061';
const ETH_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xe6eb5B9b85cFF2C84Df3De6e7855bC9E76f034d5';
const USDC_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x3e6D1ccA8Eee6d02f1f578B613374EB53E6823B4';

let oldWETHPriceFeed: string;
let oldUSDCPriceFeed: string;
let oldWSTETHPriceFeed: string;
let oldCbETHPriceFeed: string;

let newWstETHPriceFeed: string;

const blockToFetch = 40000000;

export default migration('1766403952_change_price_feeds_to_svr', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();
    const blockToFetchTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))!.timestamp;

    //1. wstEth
    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData({blockTag: blockToFetch});

    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_TO_USD_SVR_PRICE_FEED_ADDRESS,
        WSTETH_STETH_PRICE_FEED_ADDRESS,
        'wstETH / USD CAPO SVR Price Feed',
        8,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4)
        }
      ],
      true
    );
    return {
      wstETHCapoPriceFeed: wstEthCapoPriceFeed.address
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { wstETHCapoPriceFeed }: { wstETHCapoPriceFeed: string }
  ) => {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      wstETH,
      cbETH,
      WETH
    } = await deploymentManager.getContracts();

    const { governor, baseL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    newWstETHPriceFeed = wstETHCapoPriceFeed;

    const updateWEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WETH.address,
        ETH_TO_USD_SVR_PRICE_FEED_ADDRESS
      )
    );

    const updateUSDCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.setBaseTokenPriceFeed(
        comet.address,
        USDC_TO_USD_SVR_PRICE_FEED_ADDRESS
      )
    );

    const updateWstETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        wstETH.address,
        wstETHCapoPriceFeed
      )
    );

    const updateCbETHPriceFeedCalldata = await calldata(    
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        cbETH.address,
        CBETHETH_USD_SVR_PRICE_FEED_ADDRESS
      )
    );

    const deployAndUpgradeToCalldata = await calldata(
      cometAdmin.populateTransaction.deployAndUpgradeTo(
        configurator.address,
        comet.address
      )
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, configurator.address, configurator.address, configurator.address, cometAdmin.address],
        [0, 0, 0, 0, 0],
        ['updateAssetPriceFeed(address,address,address)', 'setBaseTokenPriceFeed(address,address)', 'updateAssetPriceFeed(address,address,address)', 'updateAssetPriceFeed(address,address,address)', 'deployAndUpgradeTo(address,address)'],
        [updateWEthPriceFeedCalldata, updateUSDCPriceFeedCalldata, updateWstETHPriceFeedCalldata, updateCbETHPriceFeedCalldata, deployAndUpgradeToCalldata],
      ]
    );

    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH.address);
    [,, oldWSTETHPriceFeed] = await comet.getAssetInfoByAddress(wstETH.address);
    [,, oldCbETHPriceFeed] = await comet.getAssetInfoByAddress(cbETH.address);
    oldUSDCPriceFeed = await comet.baseTokenPriceFeed();

    const mainnetActions = [
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [
          bridgeReceiver.address,
          l2ProposalData,
          3_000_000
        ]
      },
    ];

    const description = `# Update price feeds in cUSDCv3 on Base with CAPO and SVR price feeds.

## Resubmit

This proposal is a resubmission of previously passed Proposal 526, as it was not executed on L2.

Original proposal: https://www.tally.xyz/gov/compound/proposal/526

## Proposal summary

This proposal updates existing price feeds for WETH, USDC, cbETH and wstETH assets on the USDC market on Base.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH price feed is updated to their CAPO implementations.

### SVR summary

[RFP process](https://www.comp.xyz/t/oev-rfp-process-update-july-2025/6945) and community [vote](https://snapshot.box/#/s:comp-vote.eth/proposal/0xffd84200f112926e8b21793ee3750f272fc40a3f90399f86d41971a44aa3edf3) passed and decided to implement Chainlink's SVR solution for BASE markets, this proposal updates WETH and USDC price feeds to support SVR implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1074), [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

### SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates WETH, USDC, cbETH and wstETH price feeds to the CAPO and SVR implementations. This sends the encoded 'updateAssetPriceFeed', 'setBaseTokenPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Base.
`;
    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
    );

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
    const {
      comet,
      configurator,
      WETH,
      cbETH,
      wstETH
    } = await deploymentManager.getContracts();

    // 1. WETH
    const WETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH.address
    );
    const WETHInCometInfo = await comet.getAssetInfoByAddress(WETH.address);
    const WETHInConfiguratorInfo = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WETHIndexInComet];

    expect(WETHInCometInfo.priceFeed).to.eq(ETH_TO_USD_SVR_PRICE_FEED_ADDRESS);
    expect(WETHInConfiguratorInfo.priceFeed).to.eq(ETH_TO_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(ETH_TO_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 5e8); // 5$

    // 2. USDC
    const baseTokenPriceFeedFromComet = await comet.baseTokenPriceFeed();
    const baseTokenPriceFeedFromConfigurator = (
      await configurator.getConfiguration(comet.address)
    ).baseTokenPriceFeed;

    expect(baseTokenPriceFeedFromComet).to.eq(USDC_TO_USD_SVR_PRICE_FEED_ADDRESS);
    expect(baseTokenPriceFeedFromConfigurator).to.eq(USDC_TO_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(USDC_TO_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldUSDCPriceFeed), 1e6); // 0.01$
  
    // 3. wstETH
    const wstETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      wstETH.address
    );
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(wstETH.address);
    const wstETHInConfiguratorInfo = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHPriceFeed);
    expect(wstETHInConfiguratorInfo.priceFeed).to.eq(newWstETHPriceFeed);

    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWSTETHPriceFeed), 5e8); // 1$
  
    // 4. cbETH
    const cbETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      cbETH.address
    );
    const cbETHInCometInfo = await comet.getAssetInfoByAddress(cbETH.address);
    const cbETHInConfiguratorInfo = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[cbETHIndexInComet];

    expect(cbETHInCometInfo.priceFeed).to.eq(CBETHETH_USD_SVR_PRICE_FEED_ADDRESS);
    expect(cbETHInConfiguratorInfo.priceFeed).to.eq(CBETHETH_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(CBETHETH_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldCbETHPriceFeed), 8e8); // 8$
  },
});
