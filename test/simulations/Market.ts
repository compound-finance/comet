import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumberish } from "ethers";
import { CometHarnessInterface, CometInterface, ERC20, FaucetToken } from "../../build/types";
import { defactor, makeRewards, Protocol, wait } from "../helpers";

export type Rates = {
  utilization: number;
  supplyRate: number;
  borrowRate: number;
};

export class Market {
  protocol: Protocol;
  comet: CometHarnessInterface;
  baseAsset: FaucetToken;
  collateralAsset: FaucetToken;
  params: string; // XXX

  constructor(protocol: Protocol) {
    this.protocol = protocol;
    this.comet = protocol.comet;
    this.baseAsset = this.protocol.tokens['USDC'];
    this.collateralAsset = this.protocol.tokens['WETH']
    // params
  }

  async currentTvl() {
    return {
      totalSupply: (await this.comet.totalSupply()).toBigInt(),
      totalBorrow: (await this.comet.totalBorrow()).toBigInt(),
    };
  }

  async currentRates(): Promise<Rates> {
    const secondsPerYear = 60n * 60n * 24n * 365n;
    const utilization = await this.comet.getUtilization();
    const supplyRate = (await this.comet.getSupplyRate(utilization)).toBigInt() * secondsPerYear;
    const borrowRate = (await this.comet.getBorrowRate(utilization)).toBigInt() * secondsPerYear;
    // const rewardRate =
    // XXX rewards subsidy
    // Rewards rate Formula: rewardRate = (1 + [ (rewardPriceUSD * rewardSpeedPerDay) / usdcSupplyTotalUSD ]) ^ 365 - 1
    return {
      utilization: defactor(utilization),
      supplyRate: defactor(supplyRate),
      borrowRate: defactor(borrowRate),
      // rewardReward: 0.0, // XXX
      // netBorrowRate: borrow - makeRewards, // XXX
    };
  }
}