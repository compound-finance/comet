import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils, constants } from 'ethers';

const destinationChainSelector = '6916147374840168594';

const USDC_TO_USD_API3_PRICE_FEED_ADDRESS = '0xf061d556F5136263c4d66d9fFCADE8Ab43a3a704';
const RON_TO_USD_API3_PRICE_FEED_ADDRESS = '0xA708247a64Fad46874A57BA274451a8a1A1daa0c';
const ETH_TO_USD_API3_PRICE_FEED_ADDRESS = '0xbBF6e0D078c7F5750d0732cD8f3EACe9A87b2b58';

const CONSTANT_PRICE_FEED = '0x8AC2b57d15c84755A3333aD68025d2496AE3BeBD';

let newPriceFeedUSDCAddress: string;
let newPriceFeedWRONAddress: string;
let newPriceFeedWETHAddress: string;
let newPriceFeedAXSAddress: string;

let oldUSDCPriceFeed: string;
let oldWRONPriceFeed: string;
let oldWETHPriceFeed: string;
let oldAXSPriceFeed: string;

export default migration('1767889363_change_price_feeds_to_api3', {
  async prepare(deploymentManager: DeploymentManager) {
    const _usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        USDC_TO_USD_API3_PRICE_FEED_ADDRESS, // USDC / USD price feed
        8                                    // decimals
      ]
    );

    const _wronPriceFeed = await deploymentManager.deploy(
      'WRON:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        RON_TO_USD_API3_PRICE_FEED_ADDRESS, // WRON / USD price feed
        8,                                  // decimals
      ],
      true
    );

    const _wethPriceFeed = await deploymentManager.deploy(
      'WETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        ETH_TO_USD_API3_PRICE_FEED_ADDRESS, // WETH / USD price feed
        8,                                  // decimals
      ],
      true
    );

    return {
      USDCPriceFeedAddress: _usdcPriceFeed.address,
      WRONPriceFeedAddress: _wronPriceFeed.address,
      WETHPriceFeedAddress: _wethPriceFeed.address,
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { 
      USDCPriceFeedAddress,
      WRONPriceFeedAddress,
      WETHPriceFeedAddress,
    }
  ) => {
    const trace = deploymentManager.tracer();
    newPriceFeedUSDCAddress = USDCPriceFeedAddress;
    newPriceFeedWRONAddress = WRONPriceFeedAddress;
    newPriceFeedWETHAddress = WETHPriceFeedAddress;
    newPriceFeedAXSAddress = CONSTANT_PRICE_FEED;

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      USDC,
      AXS,
      WETH,
    } = await deploymentManager.getContracts();

    const {
      governor, 
      l1CCIPRouter
    } = await govDeploymentManager.getContracts();

    const updateUSDCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        USDC.address,
        newPriceFeedUSDCAddress
      )
    );

    const updateWRONPriceFeedCalldata = await calldata(
      configurator.populateTransaction.setBaseTokenPriceFeed(
        comet.address,
        newPriceFeedWRONAddress
      )
    );

    const updateWETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WETH.address,
        newPriceFeedWETHAddress
      )
    );

    const updateAXSPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        AXS.address,
        newPriceFeedAXSAddress
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
        [
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          cometAdmin.address
        ],
        [0, 0, 0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'setBaseTokenPriceFeed(address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateUSDCPriceFeedCalldata,
          updateWRONPriceFeedCalldata,
          updateWETHPriceFeedCalldata,
          updateAXSPriceFeedCalldata,
          deployAndUpgradeToCalldata],
      ]
    );

    [,, oldUSDCPriceFeed] = await comet.getAssetInfoByAddress(USDC.address);
    oldWRONPriceFeed = await comet.baseTokenPriceFeed();
    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH.address);
    [,, oldAXSPriceFeed] = await comet.getAssetInfoByAddress(AXS.address);

    const fee = await l1CCIPRouter.getFee(destinationChainSelector, [
      utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
      l2ProposalData,
      [],
      constants.AddressZero,
      '0x'
    ]);

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo WETH Comet on Ronin.
      {
        contract: l1CCIPRouter,
        signature: 'ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))',
        args:
          [
            destinationChainSelector,
            [
              utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
              l2ProposalData,
              [],
              constants.AddressZero,
              '0x'
            ]
          ],
        value: fee
      },
    ];

    const description = `# Update price feeds in cWRONv3 on Ronin with API3 price feeds.

## Proposal summary

This proposal updates existing price feeds for WRON, USDC, WETH, and AXS assets on the WRON market on Ronin.
Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1082).

## Proposal actions

The first action updates WRON, USDC, WETH, and AXS price feeds to the API3 oracle base. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Ronin.
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
      USDC,
      WETH,
      AXS,
    } = await deploymentManager.getContracts();

    // 1. USDC
    const USDCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      USDC.address
    );
    const USDCInCometInfo = await comet.getAssetInfoByAddress(USDC.address);
    const USDCInConfiguratorInfoUSDCComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[USDCIndexInComet];

    expect(USDCInCometInfo.priceFeed).to.eq(newPriceFeedUSDCAddress);
    expect(USDCInConfiguratorInfoUSDCComet.priceFeed).to.eq(newPriceFeedUSDCAddress);

    expect(await comet.getPrice(newPriceFeedUSDCAddress)).to.be.closeTo(await comet.getPrice(oldUSDCPriceFeed), 1e6);

    // 2. WRON
    const WRONPriceFeedFromComet = await comet.baseTokenPriceFeed();
    const WRONPriceFeedFromConfigurator = (
      await configurator.getConfiguration(comet.address)
    ).baseTokenPriceFeed;

    expect(WRONPriceFeedFromComet).to.eq(newPriceFeedWRONAddress);
    expect(WRONPriceFeedFromConfigurator).to.eq(newPriceFeedWRONAddress);
    expect(await comet.getPrice(newPriceFeedWRONAddress)).to.be.closeTo(await comet.getPrice(oldWRONPriceFeed), 1e6);

    // 3. WETH
    const WETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH.address
    );
    const WETHInCometInfo = await comet.getAssetInfoByAddress(WETH.address);
    const WETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WETHIndexInComet];

    expect(WETHInCometInfo.priceFeed).to.eq(newPriceFeedWETHAddress);
    expect(WETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newPriceFeedWETHAddress);
    expect(await comet.getPrice(newPriceFeedWETHAddress)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 10e8); // $10

    // 4. AXS
    const AXSIndexInComet = await configurator.getAssetIndex(
      comet.address,
      AXS.address
    );
    const AXSInCometInfo = await comet.getAssetInfoByAddress(AXS.address);
    const AXSInConfiguratorInfoAXSComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[AXSIndexInComet];

    expect(AXSInCometInfo.priceFeed).to.eq(newPriceFeedAXSAddress);
    expect(AXSInConfiguratorInfoAXSComet.priceFeed).to.eq(newPriceFeedAXSAddress);
    expect(await comet.getPrice(newPriceFeedAXSAddress)).to.be.closeTo(await comet.getPrice(oldAXSPriceFeed), 5e7); // $0.5
  },
});
