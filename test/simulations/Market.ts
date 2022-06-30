import { CometHarnessInterface, FaucetToken } from '../../build/types';
import { defactor, exp, mulPrice, Protocol } from '../helpers';

export type Rates = {
  utilization: number;
  supplyRate: number;
  borrowRate: number;
  rewardRate: number;
  netBorrowRate: number;
};

export class Market {
  protocol: Protocol;
  comet: CometHarnessInterface;
  baseAsset: FaucetToken;
  collateralAsset: FaucetToken;
  rewardAsset: FaucetToken;
  params: string; // XXX

  constructor(protocol: Protocol) {
    this.protocol = protocol;
    this.comet = protocol.comet;
    this.baseAsset = this.protocol.tokens['USDC'];
    this.collateralAsset = this.protocol.tokens['WETH'];
    this.rewardAsset = this.protocol.tokens['COMP'];
    // params
  }

  async currentTvl() {
    const baseScale = (await this.comet.baseScale()).toBigInt();
    const totalSupply = (await this.comet.totalSupply()).toBigInt() / baseScale;
    const totalBorrow = (await this.comet.totalBorrow()).toBigInt() / baseScale;

    return {
      totalSupply,
      totalBorrow,
    };
  }

  async currentRates(): Promise<Rates> {
    const secondsPerYear = 60n * 60n * 24n * 365n;
    const utilization = await this.comet.getUtilization();
    const supplyRate = (await this.comet.getSupplyRate(utilization)).toBigInt() * secondsPerYear;
    const borrowRate = (await this.comet.getBorrowRate(utilization)).toBigInt() * secondsPerYear;
    const rewardRate = await this.calculateRewardRate();

    return {
      utilization: defactor(utilization),
      supplyRate: defactor(supplyRate),
      borrowRate: defactor(borrowRate),
      rewardRate,
      netBorrowRate: defactor(borrowRate) - rewardRate,
    };
  }

  async calculateRewardRate(): Promise<number> {
    const secondsPerDay = 60n * 60n * 24n;
    const priceScale = exp(1, 8);

    // Rewards rate Formula: rewardRate = (1 + [ (rewardPriceUSD * rewardSpeedPerDay) / usdcSupplyTotalUSD ]) ^ 365 - 1
    const totalBorrow = (await this.comet.totalBorrow()).toBigInt();
    const basePrice = await this.protocol.priceFeeds[await this.baseAsset.symbol()].price();
    const totalBorrowUSD = Number(mulPrice(totalBorrow, basePrice, await this.comet.baseScale()) / priceScale);
    const rewardPrice = await this.protocol.priceFeeds[await this.rewardAsset.symbol()].price();
    const rewardSpeedPerDay = (await this.comet.baseTrackingBorrowSpeed()).toBigInt() * secondsPerDay;
    const rewardPerDayUSD = Number(mulPrice(rewardSpeedPerDay, rewardPrice, await this.comet.trackingIndexScale()) / priceScale);
    const rewardPerDayPerBorrow = rewardPerDayUSD / totalBorrowUSD;
    const rewardRate = (1 + rewardPerDayPerBorrow) ** (365) - 1;

    // console.log('totalBorrowUSD ', totalBorrowUSD)
    // console.log('rewardPrice ', rewardPrice)
    // console.log('rewardSpeedPerDay ', rewardSpeedPerDay)
    // console.log('rewardPerDayUSD ', rewardPerDayUSD)
    // console.log('rewardPerDayPerBorrow ', rewardPerDayPerBorrow)

    return rewardRate;
  }
}