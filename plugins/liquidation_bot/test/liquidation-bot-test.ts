import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { expect, use } from 'chai';
import { loop, Borrower, BorrowerMap } from '../index';
import { FakeContract, smock } from '@defi-wonderland/smock';
import { CometInterface } from '../../../build/types';

use(smock.matchers);

// let zero = '0x0000000000000000000000000000000000000000';
// let one = '0x0000000000000000000000000000000000000001';
// let two = '0x0000000000000000000000000000000000000002';
// let three = '0x0000000000000000000000000000000000000003';

async function mockComet(): Promise<FakeContract<CometInterface>> {
  return await smock.fake('Comet');
}

const liquidatableBorrower: Borrower = {
  address: ethers.constants.AddressZero,
  liquidationMargin: BigNumber.from(-1),
  lastUpdated: undefined
};

describe('LiquidationBot > loop', () => {
  it('returns unchanged borrowerMap when currentBlock <= lastBlockChecked', async () => {
    const [signer] = await ethers.getSigners();
    const comet = await mockComet();

    const initialBorrowerMap: BorrowerMap = {
      '0x01': {
        address: '0x01',
        liquidationMargin: BigNumber.from(100),
        lastUpdated: undefined
      }
    };

    const { borrowerMap } = await loop({
      absorber: signer,
      comet,
      currentBlock: 0,
      lastBlockChecked: 0,
      borrowerMap: initialBorrowerMap
    });

    expect(borrowerMap).to.deep.eq(initialBorrowerMap);
  });

  it('absorbs underwater positions in the borrowerMap', async () => {
    const [signer] = await ethers.getSigners();
    const comet = await mockComet();

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

  it('returns an updated borrowerMap', async () => {
    const [absorber] = await ethers.getSigners();
    const comet = await mockComet();

    const borrowerMap: BorrowerMap = {
      [liquidatableBorrower.address]: liquidatableBorrower
    };

    const currentBlock = await ethers.provider.getBlockNumber();
    await loop({
      absorber,
      comet,
      currentBlock,
      lastBlockChecked: 0,
      borrowerMap
    });

    // expect(comet.absorb).to.have.been.calledWith(
    //   absorber.address,
    //   [liquidatableBorrower.address]
    // );


  });
});