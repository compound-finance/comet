import {
  Comet,
  CometRewards,
  ERC20,
  GovernorSimple,
  SimpleTimelock,
  TransparentUpgradeableProxy,
} from '../../build/types';
import { AssetConfigStruct } from '../../build/types/Comet';
import { BigNumberish } from 'ethers';
export { deployNetworkComet as deployComet } from './Network';

export interface ProtocolConfiguration {
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
}

// Specific contracts take precedence over `all`, which allows for expressions
// such as:
// { all: true, timelock: false }
// which will deploy all contracts other than Timelock
export interface ContractsToDeploy {
  all?: boolean;
  cometProxy?: boolean;
  configuratorProxy?: boolean;
  cometProxyAdmin?: boolean;
  timelock?: boolean;
  governor?: boolean;
  cometExt?: boolean;
  comet?: boolean;
  configurator?: boolean;
  cometFactory?: boolean;
  rewards?: boolean;
}

export interface DeployedContracts {
  comet: Comet;
  cometProxy: TransparentUpgradeableProxy | null;
  configuratorProxy: TransparentUpgradeableProxy | null;
  timelock: SimpleTimelock;
  governor: GovernorSimple;
  rewards: CometRewards;
  tokens?: ERC20[];
}
