import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { expect, use } from 'chai';
import { loop, Borrower, BorrowerMap } from '../index';
import { FakeContract, smock } from '@defi-wonderland/smock';
import { CometInterface } from '../../../build/types';

use(smock.matchers);

describe('LiquidationBot > loop', () => {
  it.only('returns unchanged borrowerMap when currentBlock <= lastBlockChecked', async () => {
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
});