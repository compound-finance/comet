type UserInfo = {
  trackingIndex: number;
  principal: number;
}

type SlopeDefinition = {
  kink: number;
  slopeLow: number;
  slopeHigh: number;
  base: number;
}

type InterestRateModel = {
  supplySlopeDefinition: SlopeDefinition;
  borrowSlopeDefinition: SlopeDefinition;
}

class Comet {
  baseSupplyIndex: number;
  baseBorrowIndex: number;

  totalSupplyBase: number;
  totalBorrowBase: number;

  interestRateModel: InterestRateModel;

  userInfo: {[address: string]: UserInfo};

  // Principal Value //
  principalValue(presentValue) {
    if (presentValue > 0) {
      return this.principalValueSupply(presentValue);
    } else {
      return this.principalValueBorrow(presentValue);
    }
  }
  principalValueSupply(presentValue) {
    return presentValue / this.baseSupplyIndex;
  }
  principalValueBorrow(presentValue) {
    return presentValue / this.baseBorrowIndex;
  }

  // Present Value //
  presentValue(principalValue) {
    if (principalValue > 0) {
      return this.presentValueSupply(principalValue);
    } else {
      return this.presentValueBorrow(principalValue);
    }
  }
  presentValueSupply(principalValue) {
    return principalValue * this.baseSupplyIndex;
  }
  presentValueBorrow(principalValue) {
    return principalValue * this.baseBorrowIndex;
  }

  balanceOf(address: string) {
    const principal = this.userInfo[address].principal;
    return principal > 0 ? this.presentValueSupply(principal) : 0;
  }

  accrue() {
  }

  supplyBase() {
  }

  withdrawBase() {
  }

}
