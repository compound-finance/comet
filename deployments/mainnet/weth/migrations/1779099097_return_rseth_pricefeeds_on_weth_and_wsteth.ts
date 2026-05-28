import { expect } from 'chai';
import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';

const MAINNET_WETH_COMET = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';
const MAINNET_WSTETH_COMET = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';

const mainnetWethPriceFeedAddress = '0x5AbcFC8A649Ac15Ff7d41c0Dd0d53aF3bBb7F876';
const mainnetWstEthPriceFeedAddress = '0x0Af91E13383FD771f21B40b79421B2d59E8214C2';

export default migration('1779099097_return_rseth_pricefeeds_on_weth_and_wsteth', {
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

    const description = `# Return rsETH Price Feeds on WETH and wstETH Markets (Mainnet)

## Summary

This proposal is a follow-up to the emergency rsETH oracle migration and returns the Mainnet WETH and wstETH Comets to their prior rsETH price feed configuration.

The earlier migration to a MinMaxConstantPriceFeed was introduced as a temporary risk-control measure after the April 18 Kelp rsETH bridge exploit. With conditions now stabilized, this proposal removes the temporary setup and restores the previous feed configuration.

Implementation details: [PR #1122](https://github.com/compound-finance/comet/pull/1122).

## Proposal Actions

1. Update the rsETH price feed on the Mainnet WETH market.
2. Update the rsETH price feed on the Mainnet wstETH market.
3. Deploy and upgrade the WETH Comet to apply the configuration change.
4. Deploy and upgrade the wstETH Comet to apply the configuration change.
`;

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
    return true;
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

    const priceFeedWeth = new Contract(
      wethCometAssetInfo.priceFeed,
      [
        'function latestRoundData() external view returns(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
        'function decimals() external view returns (uint8)',
      ],
      await deploymentManager.getSigner());
    expect(await priceFeedWeth.decimals()).to.equal(8);
    expect((await priceFeedWeth.latestRoundData()).answer).to.not.equal(0);

    const wstEthComet = new Contract(MAINNET_WSTETH_COMET, [
      'function getAssetInfoByAddress(address asset) public view returns((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))',
    ], await deploymentManager.getSigner());

    const wstEthCometAssetInfo = await wstEthComet.getAssetInfoByAddress(rsETH.address);
    expect(wstEthCometAssetInfo.priceFeed).to.equal(mainnetWstEthPriceFeedAddress);

    const priceFeedWstEth = new Contract(
      wstEthCometAssetInfo.priceFeed,
      [
        'function latestRoundData() external view returns(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
        'function decimals() external view returns (uint8)',
      ],
      await deploymentManager.getSigner());
    expect(await priceFeedWstEth.decimals()).to.equal(8);
    expect((await priceFeedWstEth.latestRoundData()).answer).to.not.equal(0);
  },
});
