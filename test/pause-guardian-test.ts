import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  FaucetToken__factory,
  FaucetToken,
  MockedOracle,
  MockedOracle__factory,
  Comet,
  Comet__factory,
} from '../build/types';

let token: FaucetToken, comet: Comet, oracle: MockedOracle;
let governor, pauseGuardian, regularUser;

describe('Comet', function () {
  beforeEach(async () => {
    [governor, pauseGuardian, regularUser] = await ethers.getSigners();

    const FaucetTokenFactory = (await ethers.getContractFactory(
      'FaucetToken'
    )) as FaucetToken__factory;
    token = await FaucetTokenFactory.deploy(100000, 'DAI', 18, 'DAI');
    await token.deployed();

    const OracleFactory = (await ethers.getContractFactory(
      'MockedOracle'
    )) as MockedOracle__factory;
    oracle = await OracleFactory.deploy();
    await oracle.deployed();

    const CometFactory = (await ethers.getContractFactory('Comet')) as Comet__factory;
    comet = await CometFactory.deploy({
      governor: governor.address,
      pauseGuardian: pauseGuardian.address,
      priceOracle: oracle.address,
      baseToken: token.address,
    });
    await comet.deployed();

    // All pause flags should be false by default.
    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause supply', async function () {
    await comet.pause(true, false, false, false, false);

    expect(await comet.isSupplyPaused()).to.be.true;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause transfer', async function () {
    await comet.pause(false, true, false, false, false);

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.true;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause withdraw', async function () {
    await comet.pause(false, false, true, false, false);

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.true;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause absorb', async function () {
    await comet.pause(false, false, false, true, false);

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.true;
    expect(await comet.isBuyPaused()).to.be.false;
  });

  it('Should pause buy', async function () {
    await comet.pause(false, false, false, false, true);

    expect(await comet.isSupplyPaused()).to.be.false;
    expect(await comet.isTransferPaused()).to.be.false;
    expect(await comet.isWithdrawPaused()).to.be.false;
    expect(await comet.isAbsorbPaused()).to.be.false;
    expect(await comet.isBuyPaused()).to.be.true;
  });

  it('Should pause when called by governor', async function () {
    await comet.connect(governor).pause(true, true, true, true, true);

    expect(await comet.isBuyPaused()).to.be.true;
    expect(await comet.isSupplyPaused()).to.be.true;
    expect(await comet.isTransferPaused()).to.be.true;
    expect(await comet.isWithdrawPaused()).to.be.true;
    expect(await comet.isAbsorbPaused()).to.be.true;
  });

  it('Should pause when called by pause guardian', async function () {
    await comet.connect(pauseGuardian).pause(true, true, true, true, true);

    expect(await comet.isBuyPaused()).to.be.true;
    expect(await comet.isSupplyPaused()).to.be.true;
    expect(await comet.isTransferPaused()).to.be.true;
    expect(await comet.isWithdrawPaused()).to.be.true;
    expect(await comet.isAbsorbPaused()).to.be.true;
  });

  it('Should revert if not called by governor or pause guardian', async function () {
    await expect(comet.connect(regularUser).pause(true, true, true, true, true)).to.be.revertedWith(
      'Unauthorized'
    );
  });
});
