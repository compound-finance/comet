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

describe('Comet', function () {
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

    it('Should pause all', async function () {
        await comet.pause(true, true, true, true, true);

        expect(await comet.isBuyPaused()).to.be.true;
        expect(await comet.isSupplyPaused()).to.be.true;
        expect(await comet.isTransferPaused()).to.be.true;
        expect(await comet.isWithdrawPaused()).to.be.true;
        expect(await comet.isAbsorbPaused()).to.be.true;
    });
});
