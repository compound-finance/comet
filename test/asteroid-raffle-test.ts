import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  AsteroidRaffle__factory,
  AsteroidRaffle,
  FaucetToken__factory,
  FaucetToken,
  MockedOracle__factory,
} from '../build/types';

const ticketPrice = ethers.utils.parseEther('0.1');
const raffleDuration = 24 * 60 * 60;
let token: FaucetToken, raffle: AsteroidRaffle, governor;

describe('AsteroidRaffle', function () {
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
    const oracle = await OracleFactory.deploy();
    await oracle.deployed();

    const RaffleFactory = (await ethers.getContractFactory(
      'AsteroidRaffle'
    )) as AsteroidRaffle__factory;
    raffle = await RaffleFactory.connect(governor).deploy(token.address, oracle.address);
    await raffle.deployed();

    const tx = await raffle.connect(governor).initialize(ticketPrice, 24 * 60 * 60);
    await tx.wait();
  });

  it('Should enter the raffle with ether', async function () {
    const [user1, user] = await ethers.getSigners();

    const tx1 = await raffle.connect(user).enterWithEth({ value: ticketPrice });
    await tx1.wait();

    const raffleEthBalance1 = await ethers.provider.getBalance(raffle.address);
    expect(ethers.utils.formatEther(raffleEthBalance1)).to.equal(
      ethers.utils.formatEther(ticketPrice)
    );

    const userEthBalance = await user.getBalance();

    // Increase time to end the raffle
    await ethers.provider.send('evm_increaseTime', [raffleDuration + 1]);

    const tx2 = await raffle.connect(governor).determineWinner();
    await tx2.wait();

    const raffleEthBalance2 = await ethers.provider.getBalance(raffle.address);
    expect(ethers.utils.formatEther(raffleEthBalance2)).to.equal(ethers.utils.formatEther('0'));

    const winnerEthBalance = await user.getBalance();
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

    // Increase time to end the raffle
    await ethers.provider.send('evm_increaseTime', [raffleDuration + 1]);

    const tx3 = await raffle.determineWinner();
    await tx3.wait();

    const userBalance2 = await token.balanceOf(user.address);
    expect(ethers.utils.formatEther(userBalance1)).to.equal(ethers.utils.formatEther(userBalance2));
  });

  it('Should emit events', async function () {
    const [user] = await ethers.getSigners();
    const ticketPriceInTokens = 400000000;

    // Token preparations
    const tx1 = await token.allocateTo(user.address, 1000000000);
    await tx1.wait();
    const tx2 = await token.connect(user).approve(raffle.address, ticketPriceInTokens);
    await tx2.wait();

    // Enter the raffle with eth
    const tx3 = await raffle.connect(user).enterWithEth({ value: ticketPrice });
    const receipt1 = await tx3.wait();
    const newPlayerEvent1 = receipt1.events?.filter((x) => {
      return x.event == 'NewPlayer';
    })[0];
    const [isToken1, participant1, price1] = newPlayerEvent1.args;
    expect(isToken1).to.equal(false);
    expect(participant1).to.equal(user.address);
    expect(price1).to.equal(ticketPrice);

    // Enter the raffle with token
    const tx4 = await raffle.connect(user).enterWithToken();
    const receipt2 = await tx4.wait();
    const newPlayerEvent2 = receipt2.events?.filter((x) => {
      return x.event == 'NewPlayer';
    })[0];
    const [isToken2, participant2, price2] = newPlayerEvent2.args;
    expect(isToken2).to.equal(true);
    expect(participant2).to.equal(user.address);
    expect(price2).to.equal(ticketPriceInTokens);

    // Increase time to end the raffle
    await ethers.provider.send('evm_increaseTime', [raffleDuration + 1]);

    // Determine winner
    const tx5 = await raffle.determineWinner();
    const receipt3 = await tx5.wait();
    const newWinnerEvent = receipt3.events?.filter((x) => {
      return x.event == 'NewWinner';
    })[0];
    const [winner, ethPrize, tokenPrize] = newWinnerEvent.args;
    expect(winner).to.equal(user.address);
    expect(ethPrize).to.equal(ticketPrice);
    expect(tokenPrize).to.equal(ticketPriceInTokens);

    // Restart raffle
    const newTicketPrice = ethers.utils.parseEther('0.2');
    const tx6 = await raffle.connect(governor).restartRaffle(newTicketPrice, 12 * 60 * 60);
    const receipt4 = await tx6.wait();
    const restartEvent = receipt4.events?.filter((x) => {
      return x.event == 'RaffleRestarted';
    })[0];

    const block = await ethers.provider.getBlock(restartEvent.blockNumber);
    const [governorAddress, price, endTime] = restartEvent.args;
    expect(governorAddress).to.equal(governor.address);
    expect(price).to.equal(newTicketPrice);
    expect(endTime).to.equal(block.timestamp + 12 * 60 * 60);
  });

  it('Should start, finish and restart raffle', async function () {
    const [user] = await ethers.getSigners();
    const ticketPriceInTokens = 400000000;

    // Raffle State is Active
    expect(await raffle.state()).to.equal(0);

    // Token preparations
    const tx1 = await token.allocateTo(user.address, 1000000000);
    await tx1.wait();
    const tx2 = await token.connect(user).approve(raffle.address, ticketPriceInTokens);
    await tx2.wait();

    // Enter the raffle with eth
    const tx3 = await raffle.connect(user).enterWithEth({ value: ticketPrice });
    await tx3.wait();

    // Increase time to end the raffle
    await ethers.provider.send('evm_increaseTime', [raffleDuration + 1]);

    // Determine winner
    const tx4 = await raffle.determineWinner();
    await tx4.wait();

    // Raffle State is Finished
    expect(await raffle.state()).to.equal(1);

    // Restart raffle
    const newTicketPrice = ethers.utils.parseEther('0.2');
    const tx6 = await raffle.connect(governor).restartRaffle(newTicketPrice, 24 * 60 * 60);
    await tx6.wait();

    // Raffle State is Active again
    expect(await raffle.state()).to.equal(0);
  });
});
