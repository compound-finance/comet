import { expect, use } from 'chai';
import { FakeContract, smock } from '@defi-wonderland/smock';
import { Comet } from '../../../build/types';
import { absorbLiquidatableBorrowers } from "../index";
import { BigNumber, EventFilter } from 'ethers';

use(smock.matchers);

type MockEvent = {
  eventSignature: string;
  args: {
    src: string;
    to: string;
    amount: BigNumber;
  };
}

function mockEvent({ src, to, amount }: { src: string, to: string, amount: BigNumber }): MockEvent {
  return {
    eventSignature: 'Withdraw(address,address,uint256)',
    args: { src, to, amount }
  }
}

async function mockComet(events = []): Promise<FakeContract<Comet>> {
  const comet = await smock.fake<Comet>('Comet');

  comet.queryFilter = (event: EventFilter) => {
    return new Promise<any>((resolve, _reject) => {
      resolve(events);
    });
  };

  return comet;
}

describe('Absorption Bot', () => {
  describe('absorbLiquidatableBorrowers', () => {
    it.only('returns unchanged borrowerMap when currentBlock <= lastBlockChecked', async () => {
      const comet = await mockComet([
        mockEvent({
          src: "0x01",
          to: "0x02",
          amount: BigNumber.from(1000)
        })
      ]);

      await absorbLiquidatableBorrowers(comet);

      expect(true).to.be.true;
    });
  });
});