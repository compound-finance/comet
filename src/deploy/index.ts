import { AssetConfigStruct } from '../../build/types/Comet';
import { BigNumberish, Contract, PopulatedTransaction } from 'ethers';

export { cloneGov, deployNetworkComet as deployComet, sameAddress } from './Network';
export { exp, getBlock, wait } from '../../test/helpers';
export { debug } from '../../plugins/deployment_manager/Utils';

export interface ProtocolConfiguration {
  name?: string;
  symbol?: string;
  governor?: string;
  pauseGuardian?: string;
  baseToken?: string;
  baseTokenPriceFeed?: string;
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
  all?: boolean;       // Re-deploy everything (including proxies and proxy admin)
  cometMain?: boolean; // Re-deploy the main interface (config impl + comet factory + comet impl)
  cometExt?: boolean;  // Re-deploy the ext interface (comet ext)
  rewards?: boolean;   // Re-deploy the rewards contract
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
  string[],       // targets
  BigNumberish[], // values
  string[],       // signatures
  string[],       // calldatas
  string          // description
];

// Note: this list could change over time
// Ideally these wouldn't be hardcoded, but other solutions are much more complex, and slower
export const COMP_WHALES = {
  mainnet: [
    '0xea6c3db2e7fca00ea9d7211a03e83f568fc13bf7',
    '0x61258f12c459984f32b83c86a6cc10aa339396de',
    '0x9aa835bc7b8ce13b9b0c9764a52fbf71ac62ccf1',
    '0x683a4f9915d6216f73d6df50151725036bd26c02',
  ],

  testnet: [
    '0xbbfe34e868343e6f4f5e8b5308de980d7bd88c46',
  ]
};

export async function calldata(req: Promise<PopulatedTransaction>): Promise<string> {
  // Splice out the first 4 bytes (function selector) of the tx data
  return '0x' + (await req).data.slice(2 + 8);
}

export async function proposal(actions: ProposalAction[], description: string): Promise<Proposal> {
  const targets = [], values = [], signatures = [], calldatas = [];
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