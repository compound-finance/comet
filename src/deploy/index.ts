import { AssetConfigStruct } from '../../build/types/Comet';
import { BigNumberish } from 'ethers';

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

// Note: this list could change over time, based on mainnet
export const COMP_WHALES = [
  '0xea6c3db2e7fca00ea9d7211a03e83f568fc13bf7',
  '0x61258f12c459984f32b83c86a6cc10aa339396de',
  '0x9aa835bc7b8ce13b9b0c9764a52fbf71ac62ccf1',
  '0x683a4f9915d6216f73d6df50151725036bd26c02',
  '0xa1b61405791170833070c0ea61ed28728a840241',
  '0x88fb3d509fc49b515bfeb04e23f53ba339563981',
  '0x8169522c2c57883e8ef80c498aab7820da539806'
];
