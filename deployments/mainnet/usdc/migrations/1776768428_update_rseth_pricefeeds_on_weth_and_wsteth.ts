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

    const description = `# Update rsETH price feeds on WETH and wstETH markets on Mainnet

## Proposal summary

WOOF! proposes to update rsETH price feeds on WETH and wstETH markets on Mainnet to a new version.

### New price feed details
The primary mechanism of the contract relies on the exchange rate provided by the Kelp contract, while enforcing minimum and maximum boundaries. These boundary parameters are managed by the Community multisig and may be adjusted at any time without a cooldown period.

Should the retrieved exchange rate fall below the prescribed minimum, the price feed will default to the minimum capped valuation. Conversely, if the exchange rate exceeds the maximum boundary, the feed will return the maximum capped valuation.

Additionally, the contract incorporates functionality to establish a custom constant price, which is exclusively controlled by the Community multisig. Consequently, the contract is capable of operating in one of two distinct modes:

1. Exchange rate valuation subject to minimum and maximum caps.
2. A manually defined, constant valuation.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1113).


## Proposal Actions

The first action updates rsETH price feed to a new version for the WETH market on Mainnet.

The second action updates rsETH price feed to a new version for the wstETH market on Mainnet.

The third action deploys and upgrades the WETH Comet to a new version.

The fourth action deploys and upgrades the wstETH Comet to a new version.
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