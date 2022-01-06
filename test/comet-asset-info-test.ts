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

let token: FaucetToken, comet: Comet, governor, oracle: MockedOracle;

const assets = [ethers.utils.getAddress('0x73967c6a0904aa032c103b4104747e88c566b1a2'), ethers.utils.getAddress('0xe4e81fa6b16327d4b78cfeb83aade04ba7075165')];

describe('Commet', function () {
  beforeEach(async () => {
    [governor] = await ethers.getSigners();

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

    const CometFactory = (await ethers.getContractFactory(
      'Comet'
    )) as Comet__factory;
    comet = await CometFactory.deploy({
      governor: governor.address,
      priceOracle: oracle.address,
      baseToken: token.address,
      assetInfo: [{ asset: assets[0], borrowCollateralFactor: 1e18.toString(), liquidateCollateralFactor: 1e18.toString() }, { asset: assets[1], borrowCollateralFactor: 1e18.toString(), liquidateCollateralFactor: 1e18.toString() }]
    });
    await comet.deployed();
  });

  it('Should initialize Comet protocol', async function () {
    const cometGovernor = await comet.governor();
    expect(cometGovernor).to.be.equal(governor.address);

    const priceOracle = await comet.priceOracle();
    expect(priceOracle).to.be.equal(oracle.address);

    const cometBaseToken = await comet.baseToken();
    expect(cometBaseToken).to.be.equal(token.address);

    const cometNumAssets = await comet.numAssets();
    const cometMaxAssets = await comet.maxAssets();
    expect(cometMaxAssets).to.be.equal(cometNumAssets);
    expect(cometNumAssets).to.be.equal(2);

    const assetInfo00 = await comet.getAssetInfo(0);
    expect(assetInfo00.asset).to.be.equal(assets[0]);
    expect(assetInfo00.borrowCollateralFactor.toString()).to.be.equal(1e18.toString());
    expect(assetInfo00.liquidateCollateralFactor.toString()).to.be.equal(1e18.toString());

    const assetInfo01 = await comet.getAssetInfo(1);
    expect(assetInfo01.asset).to.be.equal(assets[1]);
    expect(assetInfo01.borrowCollateralFactor.toString()).to.be.equal(1e18.toString());
    expect(assetInfo01.liquidateCollateralFactor.toString()).to.be.equal(1e18.toString());
  });

  it('Should revert if index is greater that numAssets', async function () {
    await expect(comet.getAssetInfo(2)).to.be.revertedWith('asset info not found');
  });
});
