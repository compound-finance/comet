// //SPDX-License-Identifier: Unlicense
// pragma solidity ^0.8.0;

// interface Token {
//   function balanceOf(address) external view returns (uint);
//   function transfer(address, uint) external returns (bool);
//   function transferFrom(address, address, uint) external returns(bool);
// }

// contract MarketPair {
//   struct Exp {
//     uint mantissa;
//   }
//   uint constant EXP_SCALE = 1e18;

//   /*** Constants ***/
//   Token public immutable token;

//   uint public immutable baseRateMantissa;
//   uint public immutable multiplierMantissa;
//   uint public immutable collateralFactorMantissa;
//   uint public immutable liquidationIncentiveMantissa;

//   uint public constant INITIAL_BORROW_INDEX = 1e18;
//   uint public constant INITIAL_EXCHANGE_RATE = 1e18;

//   /*** Global State ***/

//   uint public lastBlockEth;
//   uint public lastBlockToken;

//   uint public borrowIndexTokenMantissa;

//   uint public totalSharesEth;
//   uint public totalSharesToken;
//   uint public totalSupplyEth;
//   uint public totalSupplyToken;
//   uint public totalBorrowsToken;

//   /*** Account State ***/

//   struct BorrowPosition {
//     uint128 indexMantissa;
//     uint128 principalAmount;
//   }

//   mapping(address => uint) public sharesEth;
//   mapping(address => uint) public sharesToken;
//   mapping(address => BorrowPosition) public borrowsToken;


//   /*** Events ***/

//   event Supply(bool isToken, address supplier, address holder, uint supplyAmount, uint exchangeRateMantissa);
//   event Withdraw(bool isToken, address holder, address recipient, uint withdrawAmount, uint exchangeRateMantissa);
//   event Borrow(bool isToken, address borrower, address recipient, uint borrowAmount, uint borrowIndexMantissa);
//   event Repay(bool isToken, address payer, address borrower, uint repayAmount, uint borrowIndexMantissa);
//   event Liquidate(bool isToken, address liquidator, address borrower, uint repayAmount, uint borrowIndexMantissa, uint exchangeRateMantissa);

//   constructor(
//               Token token_,
//               uint baseRateMantissa_,
//               uint multiplierMantissa_,
//               uint collateralFactorMantissa_,
//               uint liquidationIncentiveMantissa_
//               ) public {
//     token = token_;

//     baseRateMantissa = baseRateMantissa_;
//     multiplierMantissa = multiplierMantissa_;
//     collateralFactorMantissa = collateralFactorMantissa_;
//     liquidationIncentiveMantissa = liquidationIncentiveMantissa_;

//     lastBlockEth = getBlockNumber();
//     lastBlockToken = getBlockNumber();

//     borrowIndexTokenMantissa = INITIAL_BORROW_INDEX;
//   }

//   function supplyEth() payable external {
//     Exp memory exchangeRateEth = getExchangeRateEth(0);
//     uint sharesIncrement = msg.value / exchangeRateEth;

//     sharesEth[msg.sender] = sharesEth[msg.sender] + sharesIncrement;
//     totalSharesEth = totalSharesEth + sharesIncrement;

//     lastBlockEth = getBlockNumber();
//     emit Supply(false, msg.sender, msg.value, exchangeRateEth.mantissa);
//   }

//   function supplyToken(uint supplyAmount) external {
//     require(borrowsToken[msg.sender].principalAmount == 0, "must repay borrow first to supply");
//     Exp memory borrowIndexTokenNew = getBorrowIndexToken();
//     uint totalBorrowsTokenNew = getTotalBorrowsCurrentToken(borrowIndexTokenNew);
//     Exp memory exchangeRateToken = getExchangeRateToken(totalBorrowsTokenNew);
//     uint sharesIncrement = supplyAmount / exchangeRateToken;

//     sharesToken[msg.sender] = sharesToken[msg.sender] + sharesIncrement;
//     totalSharesToken = totalSharesToken + sharesIncrement;

//     lastBlockToken = getBlockNumber();
//     borrowIndexTokenMantissa = borrowIndexTokenNew.mantissa;
//     totalBorrowsToken = totalBorrowsTokenNew;

//     require(token.transferFrom(msg.sender, address(this), supplyAmount), "token transfer failed");

//     emit Supply(true, msg.sender, supplyAmount, exchangeRateToken.mantissa);
//   }

//   function borrowToken(uint borrowAmount) external {
//     require(sharesToken[msg.sender] == 0, "must withdraw supply first in order to borrow");
//     Exp memory borrowIndexTokenNew = getBorrowIndexToken();
//     uint totalBorrowsTokenNew = getTotalBorrowsCurrentToken(borrowIndexTokenNew) + borrowAmount;
//     uint borrowsTokenNew = getBorrowsCurrentToken(msg.sender, borrowIndexTokenNew) + borrowAmount;

//     uint sharesCurrentEth = sharesEth[msg.sender];
//     Exp memory exchangeRateEth = getExchangeRateEth(0);

//     borrowsToken[msg.sender] = BorrowPosition({
//       indexMantissa: uint128(borrowIndexTokenNew.mantissa),
//       principalAmount: uint128(borrowsTokenNew)
//     });

//     lastBlockToken = getBlockNumber();
//     borrowIndexTokenMantissa = borrowIndexTokenNew.mantissa;
//     totalBorrowsToken = totalBorrowsTokenNew;

//     require(slackForTokenBorrow(exchangeRateEth, sharesCurrentEth, borrowsTokenNew) >= 0, "not enough slack to borrow");

//     token.transfer(msg.sender, borrowAmount);

//     emit Borrow(true, msg.sender, borrowAmount, borrowIndexTokenNew.mantissa);
//   }

//   function repayToken(uint repayAmount) external {
//     Exp memory borrowIndexTokenNew = getBorrowIndexToken();
//     uint totalBorrowsCurrentToken = getTotalBorrowsCurrentToken(borrowIndexTokenNew);
//     uint borrowsCurrentToken = getBorrowsCurrentToken(msg.sender, borrowIndexTokenNew);

//     uint realRepayAmount = repayAmount > borrowsCurrentToken ? borrowsCurrentToken : repayAmount;
//     uint totalBorrowsTokenNew = totalBorrowsCurrentToken + realRepayAmount;
//     uint borrowsTokenNew = borrowsCurrentToken + realRepayAmount;

//     borrowsToken[msg.sender] = BorrowPosition({
//       indexMantissa: uint128(borrowIndexTokenNew.mantissa),
//       principalAmount: uint128(borrowsTokenNew)
//     });

//     lastBlockToken = getBlockNumber();
//     borrowIndexTokenMantissa = borrowIndexTokenNew.mantissa;
//     totalBorrowsToken = totalBorrowsTokenNew;

//     require(token.transferFrom(msg.sender, address(this), realRepayAmount), "token transfer failed");

//     emit Repay(true, msg.sender, realRepayAmount, borrowIndexTokenNew.mantissa);
//   }

//   function liquidateToken(address borrower, uint repayAmount) external {
//     Exp memory borrowIndexTokenNew = getBorrowIndexToken();
//     uint borrowsCurrentToken = getBorrowsCurrentToken(borrower, borrowIndexTokenNew);

//     uint sharesCurrentEth = sharesEth[borrower];
//     Exp memory exchangeRateEth = getExchangeRateToken(0);

//     require(slackForTokenBorrow(exchangeRateEth, sharesCurrentEth, borrowsCurrentToken) < 0, "borrower has sufficient slack and cannot be liquidated");

//     uint realRepayAmount = repayAmount > borrowsCurrentToken ? borrowsCurrentToken : repayAmount;
//     uint seizeAmountEth = realRepayAmount * fetchPriceToken() * Exp(liquidationIncentiveMantissa);
//     uint seizeSharesEth = seizeAmountEth / exchangeRateEth;
//     // TODO - put this function back
//     // repayBehalfTokenInternal(liquidator, borrower, realRepayAmount);

//     sharesEth[borrower] = sharesEth[borrower] - seizeSharesEth;
//     totalSharesEth = totalSharesEth - seizeSharesEth;

//     // This is not needed??
//     lastBlockEth = getBlockNumber();

//     msg.sender.transfer(seizeAmountEth);

//     emit Liquidate(true, msg.sender, borrower, realRepayAmount, borrowIndexTokenNew.mantissa, exchangeRateEth.mantissa);
//   }


//   function slackForTokenBorrow(Exp memory exchangeRateEth, uint sharesCurrentEth, uint borrowsCurrentToken) public returns (int) {
//     Exp memory priceToken = fetchPriceToken();
//     uint collateral = sharesCurrentEth * exchangeRateEth;
//     uint adjustedCollateral = collateral * Exp(collateralFactorMantissa) / priceToken;
//     return int(adjustedCollateral - borrowsCurrentToken);
//   }

//   function getExchangeRate(uint shares, uint cash, uint borrows) public pure returns (Exp memory) {
//     uint supply = cash + borrows;
//     if (shares == 0 || supply == 0)
//       return Exp(INITIAL_EXCHANGE_RATE);
//     return exp(supply) / shares;
//   }

//   function getExchangeRateEth(uint totalBorrowsCurrentEth) public view returns (Exp memory) {
//     return getExchangeRate(totalSharesEth, getCashEth(), totalBorrowsCurrentEth);
//   }

//   function getExchangeRateToken(uint totalBorrowsCurrentToken) public view returns (Exp memory) {
//     return getExchangeRate(totalSharesToken, getCashToken(), totalBorrowsCurrentToken);
//   }

//   function getBalanceEth(address holder) external view returns (uint) {
//     return sharesEth[holder] * getExchangeRateEth(0);
//   }

//   function getBalanceToken(address holder) external view returns (uint) {
//     return sharesToken[holder] * getExchangeRateToken(getTotalBorrowsCurrentToken(getBorrowIndexToken()));
//   }

//   function getBorrowsToken(address borrower) external view returns (uint) {
//     return getBorrowsCurrentToken(borrower, getBorrowIndexToken());
//   }

//   function getBorrowsCurrentToken(address borrower, Exp memory borrowIndexTokenNew) public view returns (uint) {
//     BorrowPosition memory pos = borrowsToken[borrower];
//     return pos.indexMantissa == 0 ? 0 : pos.principalAmount * (borrowIndexTokenNew / Exp(pos.indexMantissa));
//   }

//   function getTotalBorrowsToken() external view returns (uint) {
//     return getTotalBorrowsCurrentToken(getBorrowIndexToken());
//   }

//   function getTotalBorrowsCurrentToken(Exp memory borrowIndexTokenNew) public view returns (uint) {
//     return totalBorrowsToken * borrowIndexTokenNew / Exp(borrowIndexTokenMantissa);
//   }

//   function getBorrowIndex(Exp memory borrowIndex, Exp memory borrowRate, uint deltaBlocks) public pure returns (Exp memory) {
//     return borrowIndex * (one() + borrowRate * deltaBlocks);
//   }

//   function getBorrowIndexToken() public view returns (Exp memory) {
//     return getBorrowIndex(Exp(borrowIndexTokenMantissa), getBorrowRateToken(), getBlockNumber() - lastBlockToken);
//   }

//   function getCashEth() public view returns (uint) {
//     return getCashEthPrior();
//   }

//   function getCashEthPrior() internal view returns (uint) {
//     return address(this).balance - msg.value;
//   }

//   function getCashToken() public view returns (uint) {
//     return token.balanceOf(address(this));
//   }

//   function getUtilization(uint cash, uint borrows) public pure returns (Exp memory) {
//     uint supply = cash + borrows;
//     return supply == 0 ? Exp(0) : exp(borrows) / supply;
//   }

//   function getUtilizationEth() public view returns (Exp memory) {
//     return getUtilization(getCashEth(), 0);
//   }

//   function getUtilizationToken() public view returns (Exp memory) {
//     return getUtilization(getCashToken(), totalBorrowsToken);
//   }

//   function getBorrowRate(Exp memory utilization) public view returns (Exp memory) {
//     return Exp(baseRateMantissa) + Exp(multiplierMantissa) * utilization;
//   }

//   function getBorrowRateToken() public view returns (Exp memory) {
//     return getBorrowRate(getUtilizationToken());
//   }

//   function getBlockTimestamp() public virtual view returns (uint) {
//     return block.timestamp;
//   }

//   function getBlockNumber() public view returns (uint) {
//     return block.number;
//   }

//   // @dev Price of Token in ETH
//   function fetchPriceToken() public returns (Exp memory) {
//       // TODO change it
//       return 1e18;
//   }

// }