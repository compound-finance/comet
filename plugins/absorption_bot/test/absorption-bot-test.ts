import { ethers } from 'hardhat';
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
    it.skip('XXX', async () => {
      const [ absorber ] = await ethers.getSigners();
      const comet = await mockComet([
        mockEvent({
          src: "0x01",
          to: "0x02",
          amount: BigNumber.from(1000)
        })
      ]);

      await absorbLiquidatableBorrowers(comet, absorber);

      expect(true).to.be.true;
    });

    it('queries liquidationMargin for all Withdraw sources', async () => {
      const [ absorber, user1, user2, user3 ] = await ethers.getSigners();
      const comet = await mockComet([
        mockEvent({
          src: user1.address,
          to: user2.address,
          amount: BigNumber.from(1000)
        }),
        mockEvent({
          src: user2.address,
          to: user3.address,
          amount: BigNumber.from(1000)
        }),
      ]);

      await absorbLiquidatableBorrowers(comet, absorber);

      expect(comet.getLiquidationMargin).to.have.been.calledTwice;
      expect(comet.getLiquidationMargin.atCall(0)).to.have.been.calledWith(user1.address);
      expect(comet.getLiquidationMargin.atCall(1)).to.have.been.calledWith(user2.address);
    });

    it('attempts absorb for liquidatable positions', async () => {
      const [ absorber, solventUser, insolventUser ] = await ethers.getSigners();
      const comet = await mockComet([
        mockEvent({
          src: solventUser.address,
          to: solventUser.address,
          amount: BigNumber.from(1000)
        }),
        mockEvent({
          src: insolventUser.address,
          to: insolventUser.address,
          amount: BigNumber.from(1000)
        }),
      ]);

      comet.getLiquidationMargin.whenCalledWith(solventUser.address).returns(100);
      comet.getLiquidationMargin.whenCalledWith(insolventUser.address).returns(-100);

      await absorbLiquidatableBorrowers(comet, absorber);

      expect(comet.getLiquidationMargin).to.have.been.calledTwice;
      expect(comet.getLiquidationMargin.atCall(0)).to.have.been.calledWith(solventUser.address);
      expect(comet.getLiquidationMargin.atCall(1)).to.have.been.calledWith(insolventUser.address);

      expect(comet.absorb).to.have.been.calledOnce;
      expect(comet.absorb.atCall(0)).to.have.been.calledWith(
        absorber.address,
        [insolventUser.address]
      );
    });
  });
});