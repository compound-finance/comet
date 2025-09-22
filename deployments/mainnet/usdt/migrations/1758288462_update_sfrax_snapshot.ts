import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { utils, Contract } from 'ethers';

const SFRAX_ADDRESS = '0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32';
const SFRAX_PRICE_FEED_ADDRESS = '0x8C74B2811D2F1aD65517ADB5C65773c1E520ed2f';

let oldSnapshot: any;
const blockNumberToFetchFrom = 23397862;

export default migration('1758288462_update_sfrax_snapshot', {
  async prepare() {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    
    const sFraxToFraxPriceFeed = await deploymentManager.existing(
      'sFRAX:priceFeedToFRAX',
      SFRAX_ADDRESS,
      'mainnet',
      'contracts/IERC4626.sol:IERC4626'
    );

    const sFraxToUsdPriceFeed = new Contract(
      SFRAX_PRICE_FEED_ADDRESS,
      [
        'function maxYearlyRatioGrowthPercent() external view returns (uint32)',
        'function snapshotRatio() external view returns (uint256)'
      ],
      await deploymentManager.getSigner()
    );
    const currentMaxYearlyRatioGrowthPercent = await sFraxToUsdPriceFeed.maxYearlyRatioGrowthPercent();

    const latestBlock = await deploymentManager.hre.ethers.provider.getBlock('latest');
    if (!latestBlock) {
      throw new Error('Failed to fetch latest block');
    }

    const blockToFetchFrom = await deploymentManager.hre.ethers.provider.getBlock(blockNumberToFetchFrom);

    if (!blockToFetchFrom) {
      throw new Error('Failed to fetch block');
    }
    oldSnapshot = await sFraxToUsdPriceFeed.snapshotRatio();

    const snapshotValue = await sFraxToFraxPriceFeed.convertToAssets(exp(1, 18), { blockTag: blockToFetchFrom.number });

    const updateSnapshotCalldata = utils.defaultAbiCoder.encode(
      ['(uint256,uint48,uint32)'],
      [[snapshotValue, blockToFetchFrom.timestamp, currentMaxYearlyRatioGrowthPercent]]
    );

    const {
      governor,
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Set new snapshot for sFRAX
      {
        target: SFRAX_PRICE_FEED_ADDRESS,
        signature: 'updateSnapshot((uint256,uint48,uint32))',
        calldata: updateSnapshotCalldata
      },
    ];

    const description = `# Update sFRAX CAPO snapshot value on Mainnet

## Proposal summary

WOOF! Proposes to update snapshot value for sFRAX CAPO price feed to the correct value, since it was incorrectly set up before. The new and correct value is taken directly from the sFRAX contract on the 23397862 block.

## Proposed actions

The first proposal action updates the snapshot value for CAPO price feed for sFRAX.
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
    expect(oldSnapshot).to.not.be.undefined;
    expect(oldSnapshot).to.equal('1213274845207191283');
    const sFraxToFraxPriceFeed = new Contract(
      SFRAX_PRICE_FEED_ADDRESS,
      [
        'function maxYearlyRatioGrowthPercent() external view returns (uint32)',
        'function snapshotRatio() external view returns (uint256)'
      ],
      await deploymentManager.getSigner()
    );
    const newSnapshot = await sFraxToFraxPriceFeed.snapshotRatio();
    expect(newSnapshot).to.not.deep.equal(oldSnapshot);
  },
});
