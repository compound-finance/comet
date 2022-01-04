import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  AsteroidRaffle__factory,
  AsteroidRaffle,
  FaucetToken__factory,
  FaucetToken,
  MockedOracle__factory,
  TransparentUpgradeableProxy__factory,
} from '../build/types';

const ticketPrice = ethers.utils.parseEther('0.1');
const raffleDuration = 24 * 60 * 60;
let token: FaucetToken, raffle: AsteroidRaffle;
let governor, admin, user;
let proxied;

describe('Proxy', function () {
  beforeEach(async () => {
    [governor, admin, user] = await ethers.getSigners();

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
    raffle = await RaffleFactory.connect(governor).deploy(
      token.address,
      oracle.address
    );
    await raffle.deployed();

    const ProxyFactory = (await ethers.getContractFactory(
      'TransparentUpgradeableProxy'
    )) as TransparentUpgradeableProxy__factory;
    const proxy = await ProxyFactory.connect(governor).deploy(
      raffle.address,
      admin.address,
      []
    );
    await proxy.deployed();
    proxied = RaffleFactory.attach(proxy.address) as AsteroidRaffle;

    const tx = await proxied
      .connect(user)
      .initialize(ticketPrice, 24 * 60 * 60);
    await tx.wait();
  });

  it('Should enter the raffle with ether', async function () {
    const raffleTicketPrice = await proxied.connect(user).ticketPrice();
    expect(raffleTicketPrice).to.equal(ticketPrice);

    const initialized = await proxied.connect(user).initialized();
    expect(initialized).to.equal(true);

    // Enter the raffle and check `NewPlayer` event
    const tx1 = await proxied.connect(user).enterWithEth({ value: ticketPrice });
    const receipt1 = await tx1.wait();
    const newPlayerEvent1 = receipt1.events?.filter((x) => {
      return x.event == 'NewPlayer';
    })[0];
    const [isToken1, participant1, price1] = newPlayerEvent1.args;
    expect(isToken1).to.equal(false);
    expect(participant1).to.equal(user.address);
    expect(price1).to.equal(ticketPrice);

    const userEthBalance = await user.getBalance();

    // Increase time to end the raffle
    await ethers.provider.send('evm_increaseTime', [raffleDuration + 1]);

    // Determine winner and check the `NewWinner` event
    const tx2 = await proxied.connect(governor).determineWinner();
    const receipt = await tx2.wait();
    const newWinnerEvent = receipt.events?.filter((x) => {
      return x.event == 'NewWinner';
    })[0];
    const [winner, ethPrize, tokenPrize] = newWinnerEvent.args;
    expect(winner).to.equal(user.address);
    expect(ethPrize).to.equal(ticketPrice);
    expect(tokenPrize).to.equal(0);

    // Check winner balance
    const winnerEthBalance = await user.getBalance();
    expect(winnerEthBalance.sub(userEthBalance)).to.equal(ticketPrice);
  });

});
