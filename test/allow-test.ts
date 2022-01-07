import { expect } from 'chai';
import { ethers } from 'hardhat';
import { FaucetToken__factory, MockedOracle__factory, Comet, Comet__factory } from '../build/types';

let comet: Comet;

describe('Comet', function () {
  describe('allow', function () {
    beforeEach(async () => {
      const [admin] = await ethers.getSigners();

      const FaucetTokenFactory = (await ethers.getContractFactory(
        'FaucetToken'
      )) as FaucetToken__factory;
      const token = await FaucetTokenFactory.deploy(100000, 'DAI', 18, 'DAI');
      await token.deployed();

      const OracleFactory = (await ethers.getContractFactory(
        'MockedOracle'
      )) as MockedOracle__factory;
      const oracle = await OracleFactory.deploy();
      await oracle.deployed();

      const CometFactory = (await ethers.getContractFactory('Comet')) as Comet__factory;
      comet = await CometFactory.deploy({
        governor: admin.address,
        priceOracle: oracle.address,
        baseToken: token.address,
        assetInfo: []
      });
      await comet.deployed();
    });

    it('isAllowed defaults to false', async () => {
      const [_admin, user, manager] = await ethers.getSigners();
      const userAddress = user.address;
      const managerAddress = manager.address;

      expect(await comet.isAllowed(userAddress, managerAddress)).to.be.false;
    });

    it('allows a user to authorize a manager', async () => {
      const [_admin, user, manager] = await ethers.getSigners();
      const userAddress = user.address;
      const managerAddress = manager.address;

      const tx = await comet.connect(user).allow(managerAddress, true);
      await tx.wait();

      expect(await comet.isAllowed(userAddress, managerAddress)).to.be.true;
    });

    it('allows a user to rescind authorization', async () => {
      const [_admin, user, manager] = await ethers.getSigners();
      const userAddress = user.address;
      const managerAddress = manager.address;

      const authorizeTx = await comet.connect(user).allow(managerAddress, true);
      await authorizeTx.wait();

      expect(await comet.isAllowed(userAddress, managerAddress)).to.be.true;

      const rescindTx = await comet.connect(user).allow(managerAddress, false);
      await rescindTx.wait();

      expect(await comet.isAllowed(userAddress, managerAddress)).to.be.false;
    });
  });
});
