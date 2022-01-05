import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Comet__factory, Comet } from '../build/types';

let comet: Comet;
const GOVERNOR_ADDRESS = '0x0000000000000000000000000000000000000000'; // better test address?
const PRICE_ORACLE_ADDRESS = '0x0000000000000000000000000000000000000000';
const BASE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

describe('Comet', function () {
  describe('allow', function () {
    beforeEach(async () => {
      const CometFactory = (await ethers.getContractFactory(
        'Comet'
      )) as Comet__factory;
      comet = await CometFactory.deploy({
        governor: GOVERNOR_ADDRESS,
        priceOracle: PRICE_ORACLE_ADDRESS,
        baseToken: BASE_TOKEN_ADDRESS,
      });
      await comet.deployed();
    });

    it('isPermitted defaults to false', async () => {
      const [_admin, user, manager] = await ethers.getSigners();
      const userAddress = await user.getAddress();
      const managerAddress = await manager.getAddress();

      expect(await comet.isPermitted(userAddress, managerAddress)).to.be.false;
    });

    it('allows a user to authorize a manager', async () => {
      const [_admin, user, manager] = await ethers.getSigners();
      const userAddress = await user.getAddress();
      const managerAddress = await manager.getAddress();

      const tx = await comet.connect(user).allow(managerAddress, true);
      await tx.wait();

      expect(await comet.isPermitted(userAddress, managerAddress)).to.be.true;
    });

    it('allows a user to rescind authorization', async () => {
      const [_admin, user, manager] = await ethers.getSigners();
      const userAddress = await user.getAddress();
      const managerAddress = await manager.getAddress();

      const authorizeTx = await comet.connect(user).allow(managerAddress, true);
      await authorizeTx.wait();

      expect(await comet.isPermitted(userAddress, managerAddress)).to.be.true;

      const rescindTx = await comet.connect(user).allow(managerAddress, false);
      await rescindTx.wait();

      expect(await comet.isPermitted(userAddress, managerAddress)).to.be.false;
    });
  });
});
