type UserInfo = {
  principal: number;
}

type SlopeDefinition = {
  kink: number;
  slopeLow: number;
  slopeHigh: number;
  base: number;
}

const BASE_TOKEN = '';

class Comet {
  baseSupplyIndex: number;
  baseBorrowIndex: number;

  totalSupplyBase: number;
  totalBorrowBase: number;

  lastAccrualTime: number;

  supplySlope: SlopeDefinition;
  borrowSlope: SlopeDefinition;

  userInfo: {[address: string]: UserInfo};

  principalValue(presentValue: number) {
    if (presentValue > 0) {
      return this.principalValueSupply(presentValue);
    } else {
      return this.principalValueBorrow(presentValue);
    }
  }

  principalValueSupply(presentValue: number) {
    return presentValue / this.baseSupplyIndex;
  }

  principalValueBorrow(presentValue: number) {
    return presentValue / this.baseBorrowIndex;
  }

  presentValue(principalValue: number) {
    if (principalValue > 0) {
      return this.presentValueSupply(principalValue);
    } else {
      return this.presentValueBorrow(principalValue);
    }
  }

  presentValueSupply(principalValue: number) {
    return principalValue * this.baseSupplyIndex;
  }

  presentValueBorrow(principalValue: number) {
    return principalValue * this.baseBorrowIndex;
  }

  balanceOf(address: string) {
    const principal = this.userInfo[address].principal;
    return principal > 0 ? this.presentValue(principal) : 0;
  }

  accrue() {
    const now = Date.now();
    const timeElapsed = Date.now() - this.lastAccrualTime;

    if (timeElapsed > 0) {
      this.baseSupplyIndex += (this.baseSupplyIndex * this.getSupplyRate() * timeElapsed);
      this.baseBorrowIndex += (this.baseBorrowIndex * this.getBorrowRate() * timeElapsed);
      this.lastAccrualTime = now;
    }
  }

  getUtilization() {
    const totalSupply = this.presentValueSupply(this.totalSupplyBase);
    const totalBorrow = this.presentValueBorrow(this.totalBorrowBase);
    return totalSupply === 0 ? 0 : totalBorrow / totalSupply;
  }

  getSupplyRate() {
    const utilization = this.getUtilization();
    const { kink, slopeLow, slopeHigh, base } = this.supplySlope;

    if (utilization <= kink) {
      return base + (slopeLow * utilization);
    } else {
      return base + (slopeLow * kink) + (slopeHigh * (utilization - kink));
    }
  }

  getBorrowRate() {
    const utilization = this.getUtilization();
    const { kink, slopeLow, slopeHigh, base } = this.borrowSlope;

    if (utilization <= kink) {
      return base + (slopeLow * utilization);
    } else {
      return base + (slopeLow * kink) + (slopeHigh * (utilization - kink));
    }
  }

  supplyBase(baseAmount: number) {
    const txAmount = BASE_TOKEN.transferFrom(msg.sender, this, baseAmount);
    const userAddress = msg.sender;
    this.accrue();
    const originalBalance = this.presentValue(this.userInfo[userAddress].principal);
    const totalSupplyBaseBalance = this.presentValueSupply(this.totalSupplyBase);
    const totalBorrowBaseBalance = this.presentValueBorrow(this.totalBorrowBase);
    const { repayAmount, supplyAmount } = this.repayAndSupplyAmount(originalBalance, txAmount);
    const newTotalSupplyBaseBalance = totalSupplyBaseBalance + supplyAmount;
    const newTotalBorrowBaseBalance = totalBorrowBaseBalance + repayAmount;
    this.userInfo[userAddress].principal = this.principalValue(originalBalance + txAmount);
    this.totalSupplyBase = this.principalValueSupply(newTotalSupplyBaseBalance);
    this.totalBorrowBase = this.principalValueBorrow(newTotalBorrowBaseBalance);
  }

  repayAndSupplyAmount(balance: number, amount: number) {
    const repayAmount = Math.max(Math.min(-balance, amount), 0);
    const supplyAmount = amount - repayAmount;
    return { repayAmount, supplyAmount };
  }

  withdrawBase() {
  }
}
