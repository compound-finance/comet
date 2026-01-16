import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { expect, exp, makeProtocol, ethers, DEFAULT_PRICEFEED_DECIMALS } from './helpers';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('interest calculation', function () {
  let baseToken: FaucetToken;
  let collaterals: { [symbol: string]: FaucetToken } = {};
  let priceFeeds: { [symbol: string]: SimplePriceFeed } = {};
  
  let comet: CometHarnessInterfaceExtendedAssetList;
  let lastUpdatedTime: number;

  let baseSupplyRate: BigNumber, supplyLowSlope: BigNumber, supplyHighSlope: BigNumber, supplyKink: BigNumber;
  let baseBorrowRate: BigNumber, borrowLowSlope: BigNumber, borrowHighSlope: BigNumber, borrowKink: BigNumber;

  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let other: SignerWithAddress;

  const baseDecimals = 6;

  const interestRateParams = {
    supplyKink: exp(0.8, 18),
    supplyInterestRateBase: exp(0, 18),
    supplyInterestRateSlopeLow: exp(0.04, 18),
    supplyInterestRateSlopeHigh: exp(0.4, 18),
    borrowKink: exp(0.8, 18),
    borrowInterestRateBase: exp(0.01, 18),
    borrowInterestRateSlopeLow: exp(0.05, 18),
    borrowInterestRateSlopeHigh: exp(0.3, 18),
  };

  before(async function (){
    const protocol = await makeProtocol(interestRateParams);

    comet = protocol.cometWithExtendedAssetList;
    baseToken = protocol.tokens['USDC'] as FaucetToken;

    lastUpdatedTime = (await comet.totalsBasic()).lastAccrualTime;

    baseSupplyRate = await comet.supplyPerSecondInterestRateBase();
    supplyLowSlope = await comet.supplyPerSecondInterestRateSlopeLow();
    supplyHighSlope = await comet.supplyPerSecondInterestRateSlopeHigh();
    supplyKink = await comet.supplyKink();

    baseBorrowRate = await comet.borrowPerSecondInterestRateBase();
    borrowLowSlope = await comet.borrowPerSecondInterestRateSlopeLow();
    borrowHighSlope = await comet.borrowPerSecondInterestRateSlopeHigh();
    borrowKink = await comet.borrowKink();

    const tokens = protocol.tokens;
    for (let asset in tokens) {
      if (asset === 'USDC') continue;
      collaterals[asset] = tokens[asset] as FaucetToken;
      priceFeeds[asset] = protocol.priceFeeds[asset];
    }
    priceFeeds['USDC'] = protocol.priceFeeds['USDC'];
    [alice, bob, charlie, other] = protocol.users;

    await baseToken.allocateTo(alice.address, exp(1e10, baseDecimals));
    await baseToken.allocateTo(bob.address, exp(1e10, baseDecimals));
    await collaterals['COMP'].allocateTo(alice.address, exp(1e10, 18));
    await collaterals['COMP'].allocateTo(bob.address, exp(1e10, 18));
    await collaterals['COMP'].allocateTo(charlie.address, exp(1e10, 18));
  });

  /// Note: testcases in "regular logic" testset are dependent as they form a single flow which can be
  /// often met in the work of the protocol:
  /// create market -> supply -> supply collateral -> borrow -> borrow more to higher utilization ->
  /// -> supply to decrease utilization
  describe('regular logic', function () {
    const SUPPLY_AMOUNT: BigNumber = BigNumber.from(exp(10000, baseDecimals)); // 10k$
    const SUPPLY_AMOUNT_UNDER_KINK: BigNumber = BigNumber.from(exp(10000, baseDecimals)); // 10k$
    const COLLATERAL_VALUE: BigNumber = BigNumber.from(exp(90000, baseDecimals)); // 80k$
    let COLLATERAL_AMOUNT: BigNumber; // will be calculated from the price at later testcase
    const BORROW_AMOUNT: BigNumber = BigNumber.from(exp(2000, baseDecimals)); // 2k$
    const BORROW_AMOUNT_OVER_KINK: BigNumber = BigNumber.from(exp(6100, baseDecimals)); // 6.1k$
    const BORROW_AMOUNT_OVERUTILIZATION: BigNumber = BigNumber.from(exp(2100, baseDecimals)); // 2.1k$
    const BORROW_AMOUNT_EXCEEDS_LIMIT: BigNumber = BigNumber.from(exp(10000, baseDecimals)); // 10k$

    const WITHDRAW_AMOUNT_EXCEEDS_LIMIT: BigNumber = BigNumber.from(exp(16000, baseDecimals)); // 12k$
    const WITHDRAW_AMOUNT_EXTRA: BigNumber = BigNumber.from(exp(2000, baseDecimals)); // 2k$

    const AVERAGE_WAIT_TIME = 3600; // 1 hr

    let aliceDepositTimestamp: number;

    describe('empty market', function () {
      before(async function () {
        // wait some time
        await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
        await ethers.provider.send('evm_mine', []);
      });

      it('utilization is 0 for empty market', async () => {
        expect(await comet.getUtilization()).to.equal(0);
      });

      it('supply rate is 0 for empty market', async () => {
        expect(await comet.getSupplyRate(0)).to.equal(0);
      });

      it('borrow rate is 0 for empty market', async () => {
        expect(await comet.getBorrowRate(0)).to.equal(0);
      });

      it('initial supply index = 1', async () => {
        expect((await comet.totalsBasic()).baseSupplyIndex).to.equal(exp(1, 15));
      });

      it('initial borrow index = 1', async () => {
        expect((await comet.totalsBasic()).baseBorrowIndex).to.equal(exp(1, 15));
      });

      it('perform accrue to update state of the market (accrue action in test)', async () => {
        await comet.accrueAccount(ethers.constants.AddressZero);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        lastUpdatedTime = curUpdatedTime;
      });

      it('supply index is not growing without supplies into the market', async () => {
        expect((await comet.totalsBasic()).baseSupplyIndex).to.equal(exp(1, 15));
      });

      it('borrow index is not growing without supplies into the market', async () => {
        expect((await comet.totalsBasic()).baseBorrowIndex).to.equal(exp(1, 15));
      });
    });

    describe('supplies with no borrows', function () {
      let timeElapsed: number;
      let prevSupplyIndex: BigNumber;

      before(async function () {
        // wait some time
        await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
        await ethers.provider.send('evm_mine', []);
      });

      it('first supply to the market with no borrows accrues the state (user action in test)', async () => {
        await baseToken.connect(alice).approve(comet.address, SUPPLY_AMOUNT);
        await comet.connect(alice).supply(baseToken.address, SUPPLY_AMOUNT);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        aliceDepositTimestamp = curUpdatedTime;
        lastUpdatedTime = curUpdatedTime;
      });

      it('but does not change supply indexe (as accrue is performed before supply state changes)', async () => {
        expect((await comet.totalsBasic()).baseSupplyIndex).to.equal(exp(1, 15));
      });

      it('and does not change borrow index (as no borrows performed)', async () => {
        expect((await comet.totalsBasic()).baseBorrowIndex).to.equal(exp(1, 15));
      });

      it('supplies to the market does not spike utilization if there are no borrows', async () => {
        expect(await comet.getUtilization()).to.equal(0);
      });

      it('supply rate equals to base rate for supplies with no borrows', async () => {
        expect(await comet.getSupplyRate(0)).to.equal(baseSupplyRate);
      });

      it('borrow rate equals 0 (no borrows)', async () => {
        expect(await comet.getBorrowRate(0)).to.equal(0);
      });

      it('wait some time and get previous state', async () => {
        prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;

        // wait some time
        await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
        await ethers.provider.send('evm_mine', []);
      });

      it('accrue after some time updates state of the market (accrue action in test)', async () => {
        await comet.accrueAccount(ethers.constants.AddressZero);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        timeElapsed = curUpdatedTime - lastUpdatedTime;
        lastUpdatedTime = curUpdatedTime;
      });

      it('supply index grows according to the base rate', async () => {
        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(baseSupplyRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseSupplyIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('utilization is not growing', async () => {
        expect(await comet.getUtilization()).to.equal(0);
      });

      it('borrow index is not growing without borrows on the market', async () => {
        expect((await comet.totalsBasic()).baseBorrowIndex).to.equal(exp(1, 15));
      });

      it('supply rate equals to base rate for supplies with no borrows', async () => {
        expect(await comet.getSupplyRate(0)).to.equal(baseSupplyRate);
      });

      it('borrow rate equals 0 (no borrows)', async () => {
        expect(await comet.getBorrowRate(0)).to.equal(0);
      });

      it('alice lend displayed principle (balanceOf) grows according to the base rate', async () => {
        timeElapsed = lastUpdatedTime - aliceDepositTimestamp;
        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(baseSupplyRate).mul(timeElapsed).div(exp(1, 18)));

        // healthcheck than current index is re-calculated correctly
        const index = (await comet.totalsBasic()).baseSupplyIndex;
        expect(index).to.equal(accruedIndex);

        const principal = (await comet.userBasic(alice.address)).principal;
        const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15));

        const balance = await comet.balanceOf(alice.address);
        // 1 wei difference is possible
        expect(balance).to.be.approximately(expectedBalance, 1);
      });
    });

    describe('supplies and borrows (low slope)', function () {
      describe('supplies collateral', function () {
        let prevSupplyIndex: BigNumber;
        let timeElapsed: number;

        before(async function () {
          const colPrice = (await priceFeeds['COMP'].latestRoundData())[1];
          const colPriceInBase = colPrice.mul(exp(1, baseDecimals)).div(exp(1, DEFAULT_PRICEFEED_DECIMALS)); // as base is USDC its price is 1
          COLLATERAL_AMOUNT = BigNumber.from(COLLATERAL_VALUE).mul(exp(1, 18)).div(colPriceInBase);

          prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;

          // wait some time
          await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
          await ethers.provider.send('evm_mine', []);
        });

        it('bob supplies collateral (user action in test)', async () => {
          await collaterals['COMP'].connect(bob).approve(comet.address, COLLATERAL_AMOUNT);
          await comet.connect(bob).supply(collaterals['COMP'].address, COLLATERAL_AMOUNT);

          const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;

          timeElapsed = curUpdatedTime - lastUpdatedTime;
          lastUpdatedTime = curUpdatedTime;
        });

        it('but does not impact utilization', async () => {
          expect(await comet.getUtilization()).to.equal(0);
        });

        it('and does not impact borrow rate (as there is no borrow)', async () => {
          expect(await comet.getBorrowRate(0)).to.equal(0);
        });

        it('and does not impact borrow index (as there is no borrow)', async () => {
          expect((await comet.totalsBasic()).baseBorrowIndex).to.equal(exp(1, 15));
        });

        it('supply rate is still == base rate (as there is no borrows)', async () => {
          expect(await comet.getSupplyRate(0)).to.equal(baseSupplyRate);
        });

        it('supply index grows based on the base rate', async () => {
          const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(baseSupplyRate).mul(timeElapsed).div(exp(1, 18)));
          const index = (await comet.totalsBasic()).baseSupplyIndex;

          expect(index).to.equal(accruedIndex);
        });
      });

      describe('market gets first borrow', function () {
        let prevSupplyIndex: BigNumber, prevBorrowIndex: BigNumber;
        let prevUtilization: BigNumber;
        let timeElapsed: number;

        before(async function () {
          // wait some time
          await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
          await ethers.provider.send('evm_mine', []);

          prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
          prevBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;
          prevUtilization = BigNumber.from(0);
        });

        it('first borrow from the market accrues the state (user action in test)', async () => {
          await comet.connect(bob).withdraw(baseToken.address, BORROW_AMOUNT);

          const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
          expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
          expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

          aliceDepositTimestamp = curUpdatedTime;
          lastUpdatedTime = curUpdatedTime;
        });

        it('but does not change borrow index (as index is accrued before storage change)', async () => {
          expect((await comet.totalsBasic()).baseBorrowIndex).to.equal(exp(1, 15));
        });

        it('supply rate grows to the low slope of the interest curve', async () => {
          const expectedSupplyRate = baseSupplyRate.add(supplyLowSlope.mul(prevUtilization).div(exp(1, 18)));
          const curSupplyRate = await comet.getSupplyRate(prevUtilization);

          expect(curSupplyRate).equal(expectedSupplyRate);
        });

        it('borrow rate grows to the low slope of the interest curve', async () => {
          const expectedBorrowRate = baseBorrowRate.add(borrowLowSlope.mul(prevUtilization).div(exp(1, 18)));
          const curBorrowRate = await comet.getBorrowRate(prevUtilization);

          expect(curBorrowRate).equal(expectedBorrowRate);
        });

        it('utilization grows based on the borrowed amount', async () => {
          const curSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
          const curBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;

          const scaledBorrow = BORROW_AMOUNT.mul(curBorrowIndex).div(exp(1, 15));
          const scaledSupply = SUPPLY_AMOUNT.mul(curSupplyIndex).div(exp(1, 15));
          const expectedUtilization = scaledBorrow.mul(exp(1, 18)).div(scaledSupply); // 20%
          const currentUtilization: BigNumber = await comet.getUtilization();

          /// we can loose some weis of accuracy based on rounding errors
          expect(currentUtilization).to.be.approximately(expectedUtilization, exp(1, 4));
        });

        it('wait some time and get previous state', async () => {
          prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
          prevBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;
          prevUtilization = await comet.getUtilization();
          lastUpdatedTime = (await comet.totalsBasic()).lastAccrualTime;

          // wait some time
          await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
          await ethers.provider.send('evm_mine', []);
        });

        it('accrue after some time updates state of the market (accrue action in test)', async () => {
          await comet.accrueAccount(ethers.constants.AddressZero);

          const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
          expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
          expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

          timeElapsed = curUpdatedTime - lastUpdatedTime;
          lastUpdatedTime = curUpdatedTime;
        });

        it('supply index grows based on the low slope of the interest curve', async () => {
          const expectedSupplyRate = baseSupplyRate.add(supplyLowSlope.mul(prevUtilization).div(exp(1, 18)));

          const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));
          const index = (await comet.totalsBasic()).baseSupplyIndex;

          expect(index).to.equal(accruedIndex);
        });

        it('borrow index grows based on the low slope of the interest curve', async () => {
          const expectedBorrowRate = baseBorrowRate.add(borrowLowSlope.mul(prevUtilization).div(exp(1, 18)));

          const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));
          const index = (await comet.totalsBasic()).baseBorrowIndex;

          expect(index).to.equal(accruedIndex);
        });

        it("alice's lend displayed principle (balanceOf) grows according to the low slope", async () => {
          const expectedSupplyRate = baseSupplyRate.add(supplyLowSlope.mul(prevUtilization).div(exp(1, 18)));
          const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));

          // healthcheck than current index is re-calculated correctly
          const index = (await comet.totalsBasic()).baseSupplyIndex;
          expect(index).to.equal(accruedIndex);

          const principal = (await comet.userBasic(alice.address)).principal;
          const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15));

          const balance = await comet.balanceOf(alice.address);
          // 1 wei difference is possible
          expect(balance).to.be.approximately(expectedBalance, 1);
        });

        it("bob's displayed borrow (borrowBalanceOf) grows according to the low slope", async () => {
          const expectedBorrowRate = baseBorrowRate.add(borrowLowSlope.mul(prevUtilization).div(exp(1, 18)));
          const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));

          // healthcheck than current index is re-calculated correctly
          const index = (await comet.totalsBasic()).baseBorrowIndex;
          expect(index).to.equal(accruedIndex);

          const principal = (await comet.userBasic(bob.address)).principal;
          const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15)).mul(-1); /// -1 as principal < 0

          const balance = await comet.borrowBalanceOf(bob.address);
          // 1 wei difference is possible
          expect(balance).to.be.approximately(expectedBalance, 1);
        });
      });
    });

    describe('supplies and borrows (high slope)', function () {
      let prevSupplyIndex: BigNumber, prevBorrowIndex: BigNumber;
      let prevUtilization: BigNumber;
      let timeElapsed: number;

      before(async function () {
        // wait some time
        await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
        await ethers.provider.send('evm_mine', []);

        prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        prevBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;
        prevUtilization = await comet.getUtilization();
        lastUpdatedTime = (await comet.totalsBasic()).lastAccrualTime;
      });

      it('borrow which pushes utilization over the kink accrues the state (user action in test)', async () => {
        await comet.connect(bob).withdraw(baseToken.address, BORROW_AMOUNT_OVER_KINK);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        timeElapsed = curUpdatedTime - lastUpdatedTime;
        lastUpdatedTime = curUpdatedTime;
      });

      it('supply index grows based on the low slope of the interest curve (as supply state is updated after the accrual)', async () => {
        const expectedSupplyRate = baseSupplyRate.add(supplyLowSlope.mul(prevUtilization).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseSupplyIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('borrow index grows based on the low slope of the interest curve (as borrow state is updated after the accrual)', async () => {
        const expectedBorrowRate = baseBorrowRate.add(borrowLowSlope.mul(prevUtilization).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseBorrowIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('over the kink utilization is reached', async () => {
        const curSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        const curBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;

        const scaledBorrow = (await comet.userBasic(bob.address)).principal.mul(curBorrowIndex).div(exp(1, 15)).mul(-1); // for borrow
        const scaledSupply = (await comet.userBasic(alice.address)).principal.mul(curSupplyIndex).div(exp(1, 15));
        const expectedUtilization = scaledBorrow.mul(exp(1, 18)).div(scaledSupply); // 80% +
        const currentUtilization: BigNumber = await comet.getUtilization();

        /// we can loose some weis of accuracy based on rounding errors
        expect(currentUtilization).to.be.approximately(expectedUtilization, exp(1, 4));
        expect(currentUtilization).to.be.greaterThanOrEqual(supplyKink);
        expect(currentUtilization).to.be.greaterThanOrEqual(borrowKink);
      });

      it('supply rate grows to the high slope of the interest curve', async () => {
        const curUtilization = await comet.getUtilization();
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(supplyKink).div(exp(1, 18)));
        expectedSupplyRate = expectedSupplyRate.add(supplyHighSlope.mul(curUtilization.sub(supplyKink)).div(exp(1, 18)));

        const curSupplyRate = await comet.getSupplyRate(curUtilization);

        expect(curSupplyRate).to.equal(expectedSupplyRate);
      });

      it('borrow rate grows to the high slope of the interest curve', async () => {
        const curUtilization = await comet.getUtilization();
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(borrowKink).div(exp(1, 18)));
        expectedBorrowRate = expectedBorrowRate.add(borrowHighSlope.mul(curUtilization.sub(borrowKink)).div(exp(1, 18)));

        const curBorrowRate = await comet.getBorrowRate(curUtilization);

        expect(curBorrowRate).to.equal(expectedBorrowRate);
      });

      it('accrue updates state of the market (accrue action in test)', async () => {
        prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        prevBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;
        prevUtilization = await comet.getUtilization();
        lastUpdatedTime = (await comet.totalsBasic()).lastAccrualTime;

        await comet.accrueAccount(ethers.constants.AddressZero);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        timeElapsed = curUpdatedTime - lastUpdatedTime;
        lastUpdatedTime = curUpdatedTime;
      });

      it('supply index grows based on the high slope of the interest curve', async () => {
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(supplyKink).div(exp(1, 18)));
        expectedSupplyRate = expectedSupplyRate.add(supplyHighSlope.mul(prevUtilization.sub(supplyKink)).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseSupplyIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('borrow index grows based on the high slope of the interest curve', async () => {
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(borrowKink).div(exp(1, 18)));
        expectedBorrowRate = expectedBorrowRate.add(borrowHighSlope.mul(prevUtilization.sub(borrowKink)).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseBorrowIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('utiization corresponds to the market state', async () => {
        const curSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        const curBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;

        const scaledBorrow = (await comet.userBasic(bob.address)).principal.mul(curBorrowIndex).div(exp(1, 15)).mul(-1); // for borrow
        const scaledSupply = (await comet.userBasic(alice.address)).principal.mul(curSupplyIndex).div(exp(1, 15));
        const expectedUtilization = scaledBorrow.mul(exp(1, 18)).div(scaledSupply); // 80% +
        const currentUtilization: BigNumber = await comet.getUtilization();

        /// we can loose some weis of accuracy based on rounding errors
        expect(currentUtilization).to.be.approximately(expectedUtilization, exp(1, 4));
      });

      it("alice's lend displayed principle (balanceOf) grows according to the high slope", async () => {
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(supplyKink).div(exp(1, 18)));
        expectedSupplyRate = expectedSupplyRate.add(supplyHighSlope.mul(prevUtilization.sub(supplyKink)).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));

        // healthcheck than current index is re-calculated correctly
        const index = (await comet.totalsBasic()).baseSupplyIndex;
        expect(index).to.equal(accruedIndex);

        const principal = (await comet.userBasic(alice.address)).principal;
        const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15));

        const balance = await comet.balanceOf(alice.address);
        // 1 wei difference is possible
        expect(balance).to.be.approximately(expectedBalance, 1);
      });

      it("bob's displayed borrow (borrowBalanceOf) grows according to the high slope", async () => {
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(borrowKink).div(exp(1, 18)));
        expectedBorrowRate = expectedBorrowRate.add(borrowHighSlope.mul(prevUtilization.sub(borrowKink)).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));

        // healthcheck than current index is re-calculated correctly
        const index = (await comet.totalsBasic()).baseBorrowIndex;
        expect(index).to.equal(accruedIndex);

        const principal = (await comet.userBasic(bob.address)).principal;
        const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15)).mul(-1); /// -1 as principal < 0

        const balance = await comet.borrowBalanceOf(bob.address);
        // 1 wei difference is possible
        expect(balance).to.be.approximately(expectedBalance, 1);
      });
    });

    describe('over utilization', function () {
      let prevSupplyIndex: BigNumber, prevBorrowIndex: BigNumber;
      let prevUtilization: BigNumber;
      let timeElapsed: number;

      before(async function () {
        // wait some time
        await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
        await ethers.provider.send('evm_mine', []);

        prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        prevBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;
        prevUtilization = await comet.getUtilization();
        lastUpdatedTime = (await comet.totalsBasic()).lastAccrualTime;

        await baseToken.allocateTo(comet.address, BORROW_AMOUNT_OVERUTILIZATION);
      });

      it('can borrow to reach utilization > 100% (borrow from reserves) (user action in test)', async () => {
        await comet.connect(bob).withdraw(baseToken.address, BORROW_AMOUNT_OVERUTILIZATION);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        timeElapsed = curUpdatedTime - lastUpdatedTime;
        lastUpdatedTime = curUpdatedTime;
      });

      it('supply index grows based on the high slope of the interest curve', async () => {
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(supplyKink).div(exp(1, 18)));
        expectedSupplyRate = expectedSupplyRate.add(supplyHighSlope.mul(prevUtilization.sub(supplyKink)).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseSupplyIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('borrow index grows based on the high slope of the interest curve', async () => {
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(borrowKink).div(exp(1, 18)));
        expectedBorrowRate = expectedBorrowRate.add(borrowHighSlope.mul(prevUtilization.sub(borrowKink)).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseBorrowIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('over 100% utilization is reached', async () => {
        const curSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        const curBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;

        const scaledBorrow = (await comet.userBasic(bob.address)).principal.mul(curBorrowIndex).div(exp(1, 15)).mul(-1); // for borrow
        const scaledSupply = (await comet.userBasic(alice.address)).principal.mul(curSupplyIndex).div(exp(1, 15));
        const expectedUtilization = scaledBorrow.mul(exp(1, 18)).div(scaledSupply); // 100% +
        const currentUtilization: BigNumber = await comet.getUtilization();

        /// we can loose some weis of accuracy based on rounding errors
        expect(currentUtilization).to.be.approximately(expectedUtilization, exp(1, 4));
        expect(currentUtilization).to.be.greaterThanOrEqual(exp(1, 18)); // > 100%
      });

      it('supply rate grows to the high slope of the interest curve (> 100%)', async () => {
        const curUtilization = await comet.getUtilization();
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(supplyKink).div(exp(1, 18)));
        expectedSupplyRate = expectedSupplyRate.add(supplyHighSlope.mul(curUtilization.sub(supplyKink)).div(exp(1, 18)));

        const curSupplyRate = await comet.getSupplyRate(curUtilization);

        expect(curSupplyRate).to.equal(expectedSupplyRate);
      });

      it('borrow rate grows to the high slope of the interest curve (> 100%)', async () => {
        const curUtilization = await comet.getUtilization();
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(borrowKink).div(exp(1, 18)));
        expectedBorrowRate = expectedBorrowRate.add(borrowHighSlope.mul(curUtilization.sub(borrowKink)).div(exp(1, 18)));

        const curBorrowRate = await comet.getBorrowRate(curUtilization);

        expect(curBorrowRate).to.equal(expectedBorrowRate);
      });

      it('accrue updates state of the market (accrue action in test)', async () => {
        prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        prevBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;
        prevUtilization = await comet.getUtilization();
        lastUpdatedTime = (await comet.totalsBasic()).lastAccrualTime;

        await comet.accrueAccount(ethers.constants.AddressZero);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        timeElapsed = curUpdatedTime - lastUpdatedTime;
        lastUpdatedTime = curUpdatedTime;
      });

      it('supply index grows based on the high slope of the interest curve (> 100%)', async () => {
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(supplyKink).div(exp(1, 18)));
        expectedSupplyRate = expectedSupplyRate.add(supplyHighSlope.mul(prevUtilization.sub(supplyKink)).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseSupplyIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('borrow index grows based on the high slope of the interest curve (> 100%)', async () => {
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(borrowKink).div(exp(1, 18)));
        expectedBorrowRate = expectedBorrowRate.add(borrowHighSlope.mul(prevUtilization.sub(borrowKink)).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseBorrowIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('utiization corresponds to the market state (> 100%)', async () => {
        const curSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        const curBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;

        const scaledBorrow = (await comet.userBasic(bob.address)).principal.mul(curBorrowIndex).div(exp(1, 15)).mul(-1); // for borrow
        const scaledSupply = (await comet.userBasic(alice.address)).principal.mul(curSupplyIndex).div(exp(1, 15));
        const expectedUtilization = scaledBorrow.mul(exp(1, 18)).div(scaledSupply); // 100% +
        const currentUtilization: BigNumber = await comet.getUtilization();

        /// we can loose some weis of accuracy based on rounding errors
        expect(currentUtilization).to.be.approximately(expectedUtilization, exp(1, 4));
        expect(currentUtilization).to.be.greaterThanOrEqual(exp(1, 18)); // > 100%
      });

      it("alice's lend displayed principle (balanceOf) grows according to the high slope (> 100%)", async () => {
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(supplyKink).div(exp(1, 18)));
        expectedSupplyRate = expectedSupplyRate.add(supplyHighSlope.mul(prevUtilization.sub(supplyKink)).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));

        // healthcheck than current index is re-calculated correctly
        const index = (await comet.totalsBasic()).baseSupplyIndex;
        expect(index).to.equal(accruedIndex);

        const principal = (await comet.userBasic(alice.address)).principal;
        const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15));

        const balance = await comet.balanceOf(alice.address);
        // 1 wei difference is possible
        expect(balance).to.be.approximately(expectedBalance, 1);
      });

      it("bob's displayed borrow (borrowBalanceOf) grows according to the high slope (> 100%)", async () => {
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(borrowKink).div(exp(1, 18)));
        expectedBorrowRate = expectedBorrowRate.add(borrowHighSlope.mul(prevUtilization.sub(borrowKink)).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));

        // healthcheck than current index is re-calculated correctly
        const index = (await comet.totalsBasic()).baseBorrowIndex;
        expect(index).to.equal(accruedIndex);

        const principal = (await comet.userBasic(bob.address)).principal;
        const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15)).mul(-1); /// -1 as principal < 0

        const balance = await comet.borrowBalanceOf(bob.address);
        // 1 wei difference is possible
        expect(balance).to.be.approximately(expectedBalance, 1);
      });

      it('should revert for bob borrow which reach utilization over 200%', async () => {
        await expect(comet.connect(bob).withdraw(baseToken.address, BORROW_AMOUNT_EXCEEDS_LIMIT)).to.revertedWithCustomError(
          comet,
          'ExceedsSupportedUtilization'
        );
      });

      it('should revert for any new user pushing utilization over 200%', async () => {
        await collaterals['COMP'].connect(charlie).approve(comet.address, COLLATERAL_AMOUNT);
        await comet.connect(charlie).supply(collaterals['COMP'].address, COLLATERAL_AMOUNT);
        await expect(comet.connect(charlie).withdraw(baseToken.address, BORROW_AMOUNT_EXCEEDS_LIMIT)).to.revertedWithCustomError(
          comet,
          'ExceedsSupportedUtilization'
        );
      });
    });

    describe('new supply pushes utilization back under the kink', function () {
      let prevSupplyIndex: BigNumber, prevBorrowIndex: BigNumber;
      let prevUtilization: BigNumber;
      let timeElapsed: number;

      before(async function () {
        // wait some time
        await ethers.provider.send('evm_increaseTime', [AVERAGE_WAIT_TIME]); // 1 hr
        await ethers.provider.send('evm_mine', []);

        prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        prevBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;
        prevUtilization = await comet.getUtilization();
        lastUpdatedTime = (await comet.totalsBasic()).lastAccrualTime;
      });

      it('supply to the market to decrease utilization accrues state (user action in test)', async () => {
        await baseToken.connect(alice).approve(comet.address, SUPPLY_AMOUNT_UNDER_KINK);
        await comet.connect(alice).supply(baseToken.address, SUPPLY_AMOUNT_UNDER_KINK);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        timeElapsed = curUpdatedTime - lastUpdatedTime;
        lastUpdatedTime = curUpdatedTime;
      });

      it('supply index grows based on the high slope of the interest curve (as supply state is updated after acrrual)', async () => {
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(supplyKink).div(exp(1, 18)));
        expectedSupplyRate = expectedSupplyRate.add(supplyHighSlope.mul(prevUtilization.sub(supplyKink)).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseSupplyIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('borrow index grows based on the high slope of the interest curve (as supply state is updated after acrrual)', async () => {
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(borrowKink).div(exp(1, 18)));
        expectedBorrowRate = expectedBorrowRate.add(borrowHighSlope.mul(prevUtilization.sub(borrowKink)).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseBorrowIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('utilization is pushed under the kink', async () => {
        const curSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        const curBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;

        const scaledBorrow = (await comet.userBasic(bob.address)).principal.mul(curBorrowIndex).div(exp(1, 15)).mul(-1); // for borrow
        const scaledSupply = (await comet.userBasic(alice.address)).principal.mul(curSupplyIndex).div(exp(1, 15));
        const expectedUtilization = scaledBorrow.mul(exp(1, 18)).div(scaledSupply); // 50% +
        const currentUtilization: BigNumber = await comet.getUtilization();

        /// we can loose some weis of accuracy based on rounding errors
        expect(currentUtilization).to.be.approximately(expectedUtilization, exp(1, 4));
        expect(currentUtilization).to.be.lessThanOrEqual(supplyKink);
        expect(currentUtilization).to.be.lessThanOrEqual(borrowKink);
      });

      it('supply rate grows based on the low slope of the interest curve', async () => {
        const curUtilization = await comet.getUtilization();
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(curUtilization).div(exp(1, 18)));

        const curSupplyRate = await comet.getSupplyRate(curUtilization);

        expect(curSupplyRate).to.equal(expectedSupplyRate);
      });

      it('borrow rate grows based on the low slope of the interest curve', async () => {
        const curUtilization = await comet.getUtilization();
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(curUtilization).div(exp(1, 18)));

        const curBorrowRate = await comet.getBorrowRate(curUtilization);

        expect(curBorrowRate).to.equal(expectedBorrowRate);
      });

      it('accrue updates state of the market (accrue action in test)', async () => {
        prevSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        prevBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;
        prevUtilization = await comet.getUtilization();
        lastUpdatedTime = (await comet.totalsBasic()).lastAccrualTime;

        await comet.accrueAccount(ethers.constants.AddressZero);

        const curUpdatedTime: number = (await comet.totalsBasic()).lastAccrualTime;
        expect(curUpdatedTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
        expect(curUpdatedTime).to.be.greaterThan(lastUpdatedTime);

        timeElapsed = curUpdatedTime - lastUpdatedTime;
        lastUpdatedTime = curUpdatedTime;
      });

      it('supply index grows based on the low slope of the interest curve', async () => {
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(prevUtilization).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseSupplyIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('borrow index grows based on the low slope of the interest curve', async () => {
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(prevUtilization).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));
        const index = (await comet.totalsBasic()).baseBorrowIndex;

        expect(index).to.equal(accruedIndex);
      });

      it('utiization corresponds to the market state (< kink%)', async () => {
        const curSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;
        const curBorrowIndex = (await comet.totalsBasic()).baseBorrowIndex;

        const scaledBorrow = (await comet.userBasic(bob.address)).principal.mul(curBorrowIndex).div(exp(1, 15)).mul(-1); // for borrow
        const scaledSupply = (await comet.userBasic(alice.address)).principal.mul(curSupplyIndex).div(exp(1, 15));
        const expectedUtilization = scaledBorrow.mul(exp(1, 18)).div(scaledSupply); // 100% +
        const currentUtilization: BigNumber = await comet.getUtilization();

        /// we can loose some weis of accuracy based on rounding errors
        expect(currentUtilization).to.be.approximately(expectedUtilization, exp(1, 4));
        expect(currentUtilization).to.be.lessThanOrEqual(supplyKink);
        expect(currentUtilization).to.be.lessThanOrEqual(borrowKink);
      });

      it("alice's lend displayed principle (balanceOf) grows according to the low slope", async () => {
        let expectedSupplyRate = baseSupplyRate;
        expectedSupplyRate = expectedSupplyRate.add(supplyLowSlope.mul(prevUtilization).div(exp(1, 18)));

        const accruedIndex = prevSupplyIndex.add(prevSupplyIndex.mul(expectedSupplyRate).mul(timeElapsed).div(exp(1, 18)));

        // healthcheck than current index is re-calculated correctly
        const index = (await comet.totalsBasic()).baseSupplyIndex;
        expect(index).to.equal(accruedIndex);

        const principal = (await comet.userBasic(alice.address)).principal;
        const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15));

        const balance = await comet.balanceOf(alice.address);
        // 1 wei difference is possible
        expect(balance).to.be.approximately(expectedBalance, 1);
      });

      it("bob's displayed borrow (borrowBalanceOf) grows according to the low slope", async () => {
        let expectedBorrowRate = baseBorrowRate;
        expectedBorrowRate = expectedBorrowRate.add(borrowLowSlope.mul(prevUtilization).div(exp(1, 18)));

        const accruedIndex = prevBorrowIndex.add(prevBorrowIndex.mul(expectedBorrowRate).mul(timeElapsed).div(exp(1, 18)));

        // healthcheck than current index is re-calculated correctly
        const index = (await comet.totalsBasic()).baseBorrowIndex;
        expect(index).to.equal(accruedIndex);

        const principal = (await comet.userBasic(bob.address)).principal;
        const expectedBalance = principal.mul(accruedIndex).div(exp(1, 15)).mul(-1); /// -1 as principal < 0

        const balance = await comet.borrowBalanceOf(bob.address);
        // 1 wei difference is possible
        expect(balance).to.be.approximately(expectedBalance, 1);
      });
    });

    describe('lenders can withdraw from the market even peaking utilization', function () {
      it('withdraw by lenders does not revert if reaching >200% utilization from regular level in one step', async () => {
        await baseToken.allocateTo(comet.address, WITHDRAW_AMOUNT_EXCEEDS_LIMIT);

        let curUtilization = await comet.getUtilization();
        expect(curUtilization).to.be.lessThan(exp(1, 18)); // < 100%

        await expect(comet.connect(alice).withdraw(baseToken.address, WITHDRAW_AMOUNT_EXCEEDS_LIMIT)).to.not.be.reverted;

        // 20k supplied, 8k borrowed -> withdraw of 16k will spike utilization over 200%
        curUtilization = await comet.getUtilization();
        expect(curUtilization).to.be.greaterThanOrEqual(exp(2, 18)); // > 200%
      });

      it('withdraw by lenders does not revert within 200%+ utilization', async () => {
        let curUtilization = await comet.getUtilization();
        expect(curUtilization).to.be.greaterThanOrEqual(exp(2, 18)); // > 200%

        await expect(comet.connect(alice).withdraw(baseToken.address, WITHDRAW_AMOUNT_EXTRA)).to.not.be.reverted;

        // 4k supplied, 8k borrowed -> withdraw of 2k will spike utilization over 400%
        curUtilization = await comet.getUtilization();
        expect(curUtilization).to.be.greaterThanOrEqual(exp(4, 18)); // > 200%
      });

      it('withdraw by lenders does not revert if reaching utilization above uint64 limit (> 1900%)', async () => {
        /// withdraw everything except 1$
        const curBalance = await comet.balanceOf(alice.address);

        await expect(comet.connect(alice).withdraw(baseToken.address, curBalance.sub(exp(1, baseDecimals)))).to.not.be.reverted;

        // 2k supplied, 8k borrowed -> withdraw of 2k - 1$ will spike utilization over 8000%, exceeding uint64 limit
        const curUtilization = await comet.getUtilization();
        expect(curUtilization).to.be.greaterThanOrEqual(exp(80, 18)); // > 8000%, far exceedint uint64 limit
      });
    });
  });

  describe('edge cases', function () {
    describe('utilization cannot be inflated for empty market', function () {
      let testComet: CometHarnessInterfaceExtendedAssetList;
      let baseToken: FaucetToken;
      let colPriceInBase: BigNumber;
      let collateral: FaucetToken;

      before(async function () {
        const protocol = await makeProtocol({base: 'USDC'});
        testComet = protocol.cometWithExtendedAssetList;
        baseToken = protocol.tokens['USDC'] as FaucetToken;
        collateral = protocol.tokens['COMP'] as FaucetToken;

        const colPrice = (await protocol.priceFeeds['COMP'].latestRoundData())[1];
        colPriceInBase = colPrice.mul(exp(1, baseDecimals)).div(exp(1, DEFAULT_PRICEFEED_DECIMALS)); // as base is USDC its price is 1

        await baseToken.allocateTo(alice.address, exp(1e10, baseDecimals));
        await collateral.allocateTo(bob.address, exp(1e10, 18));
      });

      it('initial utilization is  for fresh comet', async () => {
        expect(await testComet.getUtilization()).to.equal(0);
      });

      it('alice supplies small amount', async () => {
        await baseToken.connect(alice).approve(testComet.address, exp(1, baseDecimals));
        await testComet.connect(alice).supply(baseToken.address, exp(1, baseDecimals));

        expect(await testComet.getUtilization()).to.equal(0);
      });

      it('bob supplies collateral worth of 10k$', async () => {
        const amount = BigNumber.from(exp(10001, baseDecimals)).mul(exp(1, 18)).div(colPriceInBase);

        await collateral.connect(bob).approve(testComet.address, amount);
        await testComet.connect(bob).supply(collateral.address, amount);

        expect(await testComet.getUtilization()).to.equal(0);
      });

      it('bob borrow of base asset at max will revert due to the utilization spike', async () => {
        // default collateral factor is set as 80%
        const amount = BigNumber.from(exp(8000, baseDecimals));

        await expect(testComet.connect(bob).withdraw(baseToken.address, amount)).to.revertedWithCustomError(
          testComet,
          'ExceedsSupportedUtilization'
        );
      });
    });

    describe('chain liquidation cannot be initiated because of the inflated utilization', function () {
      let testComet: CometHarnessInterfaceExtendedAssetList;
      let baseToken: FaucetToken;
      let collateral: FaucetToken;
      let colPriceInBase: BigNumber;

      before(async function () {
        const protocol = await makeProtocol(
          { 
            base: 'USDC',
            assets: {
              COMP: {
                borrowCF: exp(0.8, 18),
                liquidateCF: exp(0.85, 18),
                liquidationFactor: exp(0.9, 18),
                initialPrice: 175
              },
              USDC: {
                initialPrice: 1,
                decimals: 6
              },
            },
          });
        testComet = protocol.cometWithExtendedAssetList;
        baseToken = protocol.tokens['USDC'] as FaucetToken;
        collateral = protocol.tokens['COMP'] as FaucetToken;

        const colPrice = (await protocol.priceFeeds['COMP'].latestRoundData())[1];
        colPriceInBase = colPrice.mul(exp(1, baseDecimals)).div(exp(1, DEFAULT_PRICEFEED_DECIMALS)); // as base is USDC its price is 1

        await baseToken.allocateTo(other.address, exp(1e10, baseDecimals));
        await collateral.allocateTo(alice.address, exp(1e10, 18));
        await collateral.allocateTo(bob.address, exp(1e10, 18));
      });

      it('initial utilization is  for fresh comet', async () => {
        expect(await testComet.getUtilization()).to.equal(0);
      });

      it('lender supplies base asset worth of 10k$', async () => {
        await baseToken.connect(other).approve(testComet.address, exp(10000, baseDecimals));
        await testComet.connect(other).supply(baseToken.address, exp(10000, baseDecimals));

        expect(await testComet.getUtilization()).to.equal(0);
      });

      it('alice and bob take supply collateral ~3.5k$ each', async () => {
        const amount = BigNumber.from(exp(3500, baseDecimals)).mul(exp(1, 18)).div(colPriceInBase);

        await collateral.connect(alice).approve(testComet.address, amount);
        await testComet.connect(alice).supply(collateral.address, amount);

        await collateral.connect(bob).approve(testComet.address, amount);
        await testComet.connect(bob).supply(collateral.address, amount);

        expect(await testComet.getUtilization()).to.equal(0);
      });

      it('alice and bob borrow assets at max (80% borrow factor)', async () => {
        const aliceBalanceBefore = await baseToken.balanceOf(alice.address);
        const bobBalanceBefore = await baseToken.balanceOf(bob.address);

        // collateral factor is set as 80%
        const amount = BigNumber.from(exp(3500, baseDecimals)).mul(80).div(100);
        await testComet.connect(alice).withdraw(baseToken.address, amount);
        const aliceBalanceAfter = await baseToken.balanceOf(alice.address);

        expect(aliceBalanceAfter.sub(aliceBalanceBefore)).to.equal(amount);

        await testComet.connect(bob).withdraw(baseToken.address, amount);
        const bobBalanceAfter = await baseToken.balanceOf(bob.address);

        expect(bobBalanceAfter.sub(bobBalanceBefore)).to.equal(amount);
      });

      it('utilization is expected to be 56% (5.6k borrow vs 10k supply)', async () => {
        const currentUtilization: BigNumber = await testComet.getUtilization();
        /// utilization is scaled by 1e18, so 56% -> 56e16
        expect(currentUtilization).to.be.approximately(exp(56e16), exp(1, 12));
      });

      it('charlie deposits 100k$ worth of collateral', async () => {
        const amount = BigNumber.from(exp(101000, baseDecimals)).mul(exp(1, 18)).div(colPriceInBase);

        await collateral.allocateTo(charlie.address, amount);
        await collateral.connect(charlie).approve(testComet.address, amount);
        await testComet.connect(charlie).supply(collateral.address, amount);

        /// utilization is unchanged
        const currentUtilization: BigNumber = await testComet.getUtilization();
        /// utilization is scaled by 1e18, so 56% -> 56e16
        expect(currentUtilization).to.be.approximately(exp(56e16), exp(1, 12));
      });

      it('increase time to bring alice and bob to 1% from liqudiation', async () => {
        await ethers.provider.send('evm_increaseTime', [3600 * 24 * 360]);
        await ethers.provider.send('evm_mine', []);
        await testComet.accrueAccount(ethers.constants.AddressZero);

        expect(await testComet.isLiquidatable(bob.address)).to.be.false;
        expect(await testComet.isLiquidatable(alice.address)).to.be.false;
      });

      it('charlie cannot spike utilization over 200% to force liquidation of users in shortened time', async () => {
        // default collateral factor is set as 80%
        const amount2 = BigNumber.from(exp(80000, baseDecimals));
        await expect(testComet.connect(charlie).withdraw(baseToken.address, amount2)).to.revertedWithCustomError(
          testComet,
          'ExceedsSupportedUtilization'
        );

        expect(await testComet.isLiquidatable(bob.address)).to.be.false;
        expect(await testComet.isLiquidatable(alice.address)).to.be.false;

        await ethers.provider.send('evm_increaseTime', [7200]);
        await ethers.provider.send('evm_mine', []);
        await testComet.accrueAccount(alice.address);

        expect(await testComet.isLiquidatable(bob.address)).to.be.false;
        expect(await testComet.isLiquidatable(alice.address)).to.be.false;
      });

      it('alice and bob become liquidatable in regular time', async () => {
        await ethers.provider.send('evm_increaseTime', [3600 * 24 * 60]);
        await ethers.provider.send('evm_mine', []);
        await testComet.accrueAccount(alice.address);
        await testComet.accrueAccount(bob.address);

        expect(await testComet.isLiquidatable(bob.address)).to.be.true;
        expect(await testComet.isLiquidatable(alice.address)).to.be.true;
      });
    });
  });
});