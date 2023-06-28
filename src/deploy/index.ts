import { AssetConfigStruct } from '../../build/types/Comet';
import { BigNumberish, Contract, PopulatedTransaction } from 'ethers';

export { cloneGov, deployNetworkComet as deployComet, sameAddress } from './Network';
export { getConfiguration, getConfigurationStruct } from './NetworkConfiguration';
export { exp, getBlock, wait } from '../../test/helpers';
export { debug } from '../../plugins/deployment_manager/Utils';

export interface ProtocolConfiguration {
  name?: string;
  symbol?: string;
  governor?: string;
  pauseGuardian?: string;
  baseToken?: string;
  baseTokenPriceFeed?: string;
  extensionDelegate?: string;
  supplyKink?: BigNumberish;
  supplyPerYearInterestRateBase?: BigNumberish;
  supplyPerYearInterestRateSlopeLow?: BigNumberish;
  supplyPerYearInterestRateSlopeHigh?: BigNumberish;
  borrowKink?: BigNumberish;
  borrowPerYearInterestRateBase?: BigNumberish;
  borrowPerYearInterestRateSlopeLow?: BigNumberish;
  borrowPerYearInterestRateSlopeHigh?: BigNumberish;
  storeFrontPriceFactor?: BigNumberish;
  trackingIndexScale?: BigNumberish;
  baseTrackingSupplySpeed?: BigNumberish;
  baseTrackingBorrowSpeed?: BigNumberish;
  baseMinForRewards?: BigNumberish;
  baseBorrowMin?: BigNumberish;
  targetReserves?: BigNumberish;
  assetConfigs?: AssetConfigStruct[];
  rewardTokenAddress?: string;
}

// If `all` is specified, it takes precedence.
// Other options are independent of one another.
export interface DeploySpec {
  all?: boolean; // Re-deploy everything (including proxies and proxy admin)
  cometMain?: boolean; // Re-deploy the main interface (config impl + comet factory + comet impl)
  cometExt?: boolean; // Re-deploy the ext interface (comet ext)
  rewards?: boolean; // Re-deploy the rewards contract
}

export interface ContractAction {
  contract: Contract;
  value?: BigNumberish;
  signature: string;
  args: any[];
}

export interface TargetAction {
  target: string;
  value?: BigNumberish;
  signature: string;
  calldata: string;
}

export type ProposalAction = ContractAction | TargetAction;
export type Proposal = [
  string[], // targets
  BigNumberish[], // values
  string[], // signatures
  string[], // calldatas
  string // description
];

// Note: this list could change over time
// Ideally these wouldn't be hardcoded, but other solutions are much more complex, and slower
export const COMP_WHALES = {
  mainnet: [
    '0xea6c3db2e7fca00ea9d7211a03e83f568fc13bf7',
    '0x61258f12c459984f32b83c86a6cc10aa339396de',
    '0x9aa835bc7b8ce13b9b0c9764a52fbf71ac62ccf1',
    '0x683a4f9915d6216f73d6df50151725036bd26c02'
  ],

  testnet: ['0xbbfe34e868343e6f4f5e8b5308de980d7bd88c46']
};

export const WHALES = {
  mainnet: [
    '0xf977814e90da44bfa03b6295a0616a897441acec',
    '0x0548f59fee79f8832c299e01dca5c76f034f558e',
    '0x218b95be3ed99141b0144dba6ce88807c4ad7c09',
    '0xf04a5cc80b1e94c69b48f5ee68a08cd2f09a7c3e',
    '0x2775b1c75658be0f640272ccb8c72ac986009e38',
    '0x1a9c8182c09f50c8318d769245bea52c32be35bc',
    '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b'
  ],
  polygon: [
    '0x2093b4281990a568c9d588b8bce3bfd7a1557ebd', // WETH whale
    '0xd814b26554204245a30f8a42c289af582421bf04', // WBTC whale
    '0x167384319b41f7094e62f7506409eb38079abff8'  // WMATIC whale
  ],
  arbitrum: [
    '0xf89d7b9c864f589bbf53a82105107622b35eaa40', // USDC whale
    '0x7b7b957c284c2c227c980d6e2f804311947b84d0', // WBTC whale
    '0x88730d254A2f7e6AC8388c3198aFd694bA9f7fae'  // COMP whale
  ],
  'arbitrum-goerli': [
    '0x4984cbfa5b199e5920995883d345bbe14b005db7', // USDC whale
    '0xbbfe34e868343e6f4f5e8b5308de980d7bd88c46', // LINK whale
    '0x8DA65F8E3Aa22A498211fc4204C498ae9050DAE4'  // COMP whale
  ],
  'base-goerli': [
    '0x21856935e5689490c72865f34CC665D0FF25664b'  // USDC whale
  ],
  'linea-goerli': [
    '0xC858966280Da3Fa0348E51D2c3B892EcC889fC98', // USDC whale
    '0x44411c605eb7e009cad03f3847cfbbfcf8895130'  // COMP whale
  ]
};

export async function calldata(req: Promise<PopulatedTransaction>): Promise<string> {
  // Splice out the first 4 bytes (function selector) of the tx data
  return '0x' + (await req).data.slice(2 + 8);
}

export async function proposal(actions: ProposalAction[], description: string): Promise<Proposal> {
  const targets = [],
    values = [],
    signatures = [],
    calldatas = [];
  for (const action of actions) {
    if (action['contract']) {
      const { contract, value, signature, args } = action as ContractAction;
      targets.push(contract.address);
      values.push(value ?? 0);
      signatures.push(signature);
      calldatas.push(await calldata(contract.populateTransaction[signature](...args)));
    } else {
      const { target, value, signature, calldata } = action as TargetAction;
      targets.push(target);
      values.push(value ?? 0);
      signatures.push(signature);
      calldatas.push(calldata);
    }
  }
  return [targets, values, signatures, calldatas, description];
}
