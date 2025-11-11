import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WSUPEROETHB_ADDRESS = '0x7FcD174E80f264448ebeE8c88a7C4476AAF58Ea6';
const WSUPEROETHB_PRICE_FEED = '0x8671d5e3a10639a573bACffEF448CA076b2d5cD7';
let newPriceFeedAddress: string;

export default migration('1756655343_add_wsuperoethb_as_collateral', {
  async prepare() {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();

    const wsuperOETHb = await deploymentManager.existing(
      'wsuperOETHb',
      WSUPEROETHB_ADDRESS,
      'base',
      'contracts/ERC20.sol:ERC20'
    );
    const wsuperOETHbPriceFeed = await deploymentManager.existing(
      'wsuperOETHb:priceFeed',
      WSUPEROETHB_PRICE_FEED,
      'base'
    );

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { governor, baseL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: wsuperOETHb.address,
      priceFeed: wsuperOETHbPriceFeed.address,
      decimals: await wsuperOETHb.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(2_000, 18),
    };

    newPriceFeedAddress = wsuperOETHbPriceFeed.address;

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [addAssetCalldata, deployAndUpgradeToCalldata],
      ]
    );

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = `# Add wsuperOETHb as collateral into cUSDSv3 on Base

## Proposal summary

WOOF! proposes to add wsuperOETHb into cUSDSv3 on Base network. This proposal takes the governance steps recommended and necessary to update a Compound III USDS market on Base. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-wsuperoethb-market-to-base-stablecoin-markets-usdc-usds/7101/2).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1021) and [forum discussion](https://www.comp.xyz/t/add-wsuperoethb-market-to-base-stablecoin-markets-usdc-usds/7101).


## Proposal Actions

The first proposal action adds wsuperOETHb to the USDS Comet on Base. This sends the encoded 'addAsset' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Base.`;
    
    const txn = await govDeploymentManager.retry(async () =>
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

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const wsuperOETHbAssetIndex = Number(await comet.numAssets()) - 1;

    const wsuperOETHbAssetConfig = {
      asset: WSUPEROETHB_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(2_000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const wsuperOETHbAssetInfo = await comet.getAssetInfoByAddress(WSUPEROETHB_ADDRESS);
    expect(wsuperOETHbAssetIndex).to.be.equal(wsuperOETHbAssetInfo.offset);
    expect(wsuperOETHbAssetConfig.asset).to.be.equal(wsuperOETHbAssetInfo.asset);
    expect(wsuperOETHbAssetConfig.priceFeed).to.be.equal(wsuperOETHbAssetInfo.priceFeed);
    expect(exp(1, wsuperOETHbAssetConfig.decimals)).to.be.equal(wsuperOETHbAssetInfo.scale);
    expect(wsuperOETHbAssetConfig.borrowCollateralFactor).to.be.equal(wsuperOETHbAssetInfo.borrowCollateralFactor);
    expect(wsuperOETHbAssetConfig.liquidateCollateralFactor).to.be.equal(wsuperOETHbAssetInfo.liquidateCollateralFactor);
    expect(wsuperOETHbAssetConfig.liquidationFactor).to.be.equal(wsuperOETHbAssetInfo.liquidationFactor);
    expect(wsuperOETHbAssetConfig.supplyCap).to.be.equal(wsuperOETHbAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWsuperOETHbAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wsuperOETHbAssetIndex];
    expect(wsuperOETHbAssetConfig.asset).to.be.equal(configuratorWsuperOETHbAssetConfig.asset);
    expect(wsuperOETHbAssetConfig.priceFeed).to.be.equal(configuratorWsuperOETHbAssetConfig.priceFeed);
    expect(wsuperOETHbAssetConfig.decimals).to.be.equal(configuratorWsuperOETHbAssetConfig.decimals);
    expect(wsuperOETHbAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWsuperOETHbAssetConfig.borrowCollateralFactor);
    expect(wsuperOETHbAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWsuperOETHbAssetConfig.liquidateCollateralFactor);
    expect(wsuperOETHbAssetConfig.liquidationFactor).to.be.equal(configuratorWsuperOETHbAssetConfig.liquidationFactor);
    expect(wsuperOETHbAssetConfig.supplyCap).to.be.equal(configuratorWsuperOETHbAssetConfig.supplyCap);
  },
});
