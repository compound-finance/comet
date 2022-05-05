import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { expect, use } from 'chai';
import { loop, Borrower, BorrowerMap } from '../index';
import { FakeContract, smock } from '@defi-wonderland/smock';
import { CometInterface } from '../../../build/types';

use(smock.matchers);

async function mockComet(): Promise<FakeContract<CometInterface>> {
  return await smock.fake('Comet');
}

describe('LiquidationBot > loop', () => {
  it('returns unchanged borrowerMap when currentBlock <= lastBlockChecked', async () => {
    const [signer] = await ethers.getSigners();

    const fakeComet: FakeContract<CometInterface> = await smock.fake('Comet');

    const borrowerMap: BorrowerMap = {
      '0x01': {
        address: '0x01',
        liquidationMargin: BigNumber.from(100),
        lastUpdated: undefined
      }
    };

    const { updatedBorrowerMap } = await loop({
      absorber: signer,
      comet: fakeComet,
      currentBlock: 0,
      lastBlockChecked: 0,
      borrowerMap
    });

    expect(updatedBorrowerMap).to.deep.eq(borrowerMap);
  });

  it.only('absorbs underwater positions in the borrowerMap', async () => {
    const [signer] = await ethers.getSigners();
    const comet = await mockComet();

    const liquidatableBorrower: Borrower = {
      address: ethers.constants.AddressZero,
      liquidationMargin: BigNumber.from(-1),
      lastUpdated: undefined
    };

    const borrowerMap: BorrowerMap = {
      [liquidatableBorrower.address]: liquidatableBorrower
    };

    const currentBlock = await ethers.provider.getBlockNumber();
    await loop({
      absorber: signer,
      comet,
      currentBlock,
      lastBlockChecked: 0,
      borrowerMap
    });

    expect(comet.absorb).to.have.been.calledWith(
      signer.address,
      [liquidatableBorrower.address]
    );
  });

  it.skip('returns an updated borrowerMap', async () => {
  });
});