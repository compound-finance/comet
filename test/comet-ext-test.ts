import { CometHarnessInterface, FaucetToken } from '../build/types';
import { baseBalanceOf, expect, exp, makeProtocol, setTotalsBasic } from './helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('CometExt', function () {
  let comet: CometHarnessInterface;
  let user: SignerWithAddress;
  let tokens: { [symbol: string]: FaucetToken };

  beforeEach(async () => {
    ({
      comet,
      users: [user],
      tokens,
    } = await makeProtocol());

    // Set different indices
    await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 3e15,
    });
  });

  it('returns factor scale', async () => {
    const factorScale = await comet.factorScale();
    expect(factorScale).to.eq(exp(1, 18));
  });

  it('returns price scale', async () => {
    const priceScale = await comet.priceScale();
    expect(priceScale).to.eq(exp(1, 8));
  });

  describe('borrowBalanceOf', function () {
    it('returns borrow amount (when principal amount is negative)', async () => {
      await comet.setBasePrincipal(user.address, -100e6); // borrow of $100 USDC

      const borrowBalanceOf = await comet.borrowBalanceOf(user.address);
      expect(borrowBalanceOf).to.eq(300e6) // baseSupplyIndex = 3e15
    });

    it('returns 0 when principal amount is positive', async () => {
      await comet.setBasePrincipal(user.address, 100e6);

      const borrowBalanceOf = await comet.borrowBalanceOf(user.address);
      expect(borrowBalanceOf).to.eq(0);
    });
  });

  it('returns principal as baseBalanceOf', async () => {
    await comet.setBasePrincipal(user.address, 100e6);

    expect(await baseBalanceOf(comet, user.address)).to.eq(BigInt(200e6)); // baseSupplyIndex = 2e15
  });

  it('returns collateralBalance (in units of the collateral asset)', async () => {
    const { WETH } = tokens;

    await comet.setCollateralBalance(
      user.address,
      WETH.address,
      exp(5, 18)
    );

    const collateralBalanceOf = await comet.collateralBalanceOf(
      user.address,
      WETH.address
    );
    expect(collateralBalanceOf).to.eq(exp(5,18));
  });

});
