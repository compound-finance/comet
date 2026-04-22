import { expect } from 'chai';
import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';

const MAINNET_WETH_COMET = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';
const MAINNET_WSTETH_COMET = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';

const mainnetWethPriceFeedAddress = '0x49BB78FBB6ADEbD1fc75296213C8E60EBd434187';
const mainnetWstEthPriceFeedAddress = '0x6407efA45FB767f594e1e966ECcb621176c58b28';

export default migration('1776768428_update_rseth_pricefeeds_on_weth_and_wsteth', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      configurator,
      cometAdmin,
      rsETH,
      governor,
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Update the price feed for rsETH in the WETH market on Mainnet
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [MAINNET_WETH_COMET, rsETH.address, mainnetWethPriceFeedAddress],
      },
      // 2. Update the price feed for rsETH in the wstETH market on Mainnet
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [MAINNET_WSTETH_COMET, rsETH.address, mainnetWstEthPriceFeedAddress],
      },
      // 3. Deploy and upgrade WETH Comet to a new version 
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, MAINNET_WETH_COMET],
      },
      // 4. Deploy and upgrade wstETH Comet to a new version 
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, MAINNET_WSTETH_COMET],
      },
    ];

    const description = `# Update rsETH Price Feeds on WETH and wstETH Markets (Mainnet)

## Summary

It is proposed to migrate the rsETH price feeds on the Mainnet WETH and wstETH Comets to a new `MinMaxConstantPriceFeed` contract. This follows [Gauntlet's proposal](https://www.comp.xyz/t/rseth-oracle-migration-and-temporary-liquidation-pause-on-ethereum-weth-and-wsteth-markets/7772) in response to the April 18 Kelp rsETH bridge exploit, and gives the Community Multisig a faster defensive lever than a full governance cycle.

This is intended as a temporary measure. Once the rsETH situation is resolved, a subsequent governance proposal will revert the price feeds to the prior configuration.

## New Price Feed

The new feed wraps the existing Kelp exchange rate and operates in one of two modes, set by the Community Multisig:

1. **Bounded exchange rate (default).** Passes the Kelp exchange rate through unchanged when it sits between configured `min` and `max` bounds. If the rate falls below `min` or rises above `max`, the feed returns the bound. Setting `min = 0` and `max = ∞` reproduces the existing oracle behavior.
2. **Constant price.** Returns a fixed price set by the multisig, bypassing the underlying feed. Intended for cases where the exchange rate can no longer be trusted.

Bounds and mode changes are multisig-only, with no cooldown. A cursory review by SSPs was already performed and a final audit confirmation will be linked on the forum prior to proposal vote.

Implementation details: [PR #1113](https://github.com/compound-finance/comet/pull/1113).

## Proposal Actions

1. Update the rsETH price feed on the Mainnet WETH market.
2. Update the rsETH price feed on the Mainnet wstETH market.
3. Deploy and upgrade the WETH Comet to the new implementation.
4. Deploy and upgrade the wstETH Comet to the new implementation.

On execution, the liquidation pause on rsETH/wrsETH collateral in these markets will be lifted. A follow-up proposal will revert these markets to their prior price feed configuration once the incident is resolved.`;

    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 600_000
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
      rsETH
    } = await deploymentManager.getContracts();

    const cometWETH = new Contract(MAINNET_WETH_COMET, [
      'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
    ], await deploymentManager.getSigner());

    const wethCometAssetInfo = await cometWETH.getAssetInfoByAddress(rsETH.address);
    expect(wethCometAssetInfo.priceFeed).to.equal(mainnetWethPriceFeedAddress);

    const wstEthComet = new Contract(MAINNET_WSTETH_COMET, [
      'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
    ], await deploymentManager.getSigner());

    const wstEthCometAssetInfo = await wstEthComet.getAssetInfoByAddress(rsETH.address);
    expect(wstEthCometAssetInfo.priceFeed).to.equal(mainnetWstEthPriceFeedAddress);
  },
});
