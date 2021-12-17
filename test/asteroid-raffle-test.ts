import { expect } from 'chai';
import { ethers, waffle } from 'hardhat';

const provider = waffle.provider;
const ticketPrice = ethers.utils.parseEther("0.1");
let token, raffle, governor;

describe('AsteroidRaffle', function () {
  beforeEach(async () => {
    [governor] = await ethers.getSigners();

    const FaucetToken = await ethers.getContractFactory('FaucetToken');
    token = await FaucetToken.deploy(100000, "DAI", 18, "DAI");
    await token.deployed();

    const Oracle = await ethers.getContractFactory('MockedOracle');
    const oracle = await Oracle.deploy();
    await oracle.deployed();

    const raffleFactory = await ethers.getContractFactory('AsteroidRaffle');
    raffle = await raffleFactory.connect(governor).deploy(ticketPrice, token.address, oracle.address);
    await raffle.deployed();
  });

  it('Should enter the raffle with ether', async function () {
    const [user1, user] = await ethers.getSigners();

    const tx1 = await raffle.connect(user).enterWithEth({ value: ticketPrice });
    await tx1.wait();

    const raffleEthBalance1 = await provider.getBalance(raffle.address);
    expect(ethers.utils.formatEther(raffleEthBalance1)).to.equal(ethers.utils.formatEther(ticketPrice));

    const userEthBalance = await provider.getBalance(user.address);

    const tx2 = await raffle.connect(governor).determineWinner();
    await tx2.wait();

    await expect(raffle.determineWinner()).to.emit(raffle, 'NewWinner').withArgs(user.address, 0, 0);
    const raffleEthBalance2 = await provider.getBalance(raffle.address);
    expect(ethers.utils.formatEther(raffleEthBalance2)).to.equal(ethers.utils.formatEther('0'));

    const winnerEthBalance = await provider.getBalance(user.address);
    expect(winnerEthBalance.sub(userEthBalance)).to.equal(ticketPrice);
  });

  it('Should enter the raffle with token', async function () {
    const [user] = await ethers.getSigners();

    const tx = await token.allocateTo(user.address, 1000000000);
    await tx.wait();

    const raffleBalance1 = await token.balanceOf(raffle.address);
    expect(ethers.utils.formatEther(raffleBalance1)).to.equal(ethers.utils.formatEther(0));

    const tx1 = await token.connect(user).approve(raffle.address, 400000000);
    await tx1.wait();

    const userBalance1 = await token.balanceOf(user.address);

    const tx2 = await raffle.connect(user).enterWithToken();
    await tx2.wait();

    const raffleBalance2 = await token.balanceOf(raffle.address);
    expect(ethers.utils.formatEther(raffleBalance2)).to.equal(ethers.utils.formatEther(400000000));

    const tx3 = await raffle.determineWinner();
    await tx3.wait();

    const userBalance2 = await token.balanceOf(user.address);
    expect(ethers.utils.formatEther(userBalance1)).to.equal(ethers.utils.formatEther(userBalance2));
  });
});
