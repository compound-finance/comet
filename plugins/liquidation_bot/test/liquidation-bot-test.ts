import { ethers, BigNumber } from 'ethers';
import { expect } from 'chai';
import { loop, Borrower, BorrowerMap } from '../index';

describe('LiquidationBot > loop', () => {
  it.only('returns unchanged borrowerMap when currentBlock <= lastBlockChecked', async () => {
    const borrowerMap: BorrowerMap = {
      '0x01': {
        address: '0x01',
        liquidationMargin: BigNumber.from(100),
        lastUpdated: undefined
      }
    };
    const { updatedBorrowerMap } = await loop(0, 0, borrowerMap);
    expect(updatedBorrowerMap).to.deep.eq(borrowerMap);
  });
});