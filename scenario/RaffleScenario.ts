import { scenario } from './Context';
import { expect } from 'chai';

// enterWithEth
scenario.only("a player can enter via enterWithEth", {}, async ({actors, contracts, players}, world) => {
  const { albert } = actors;
  const { raffle } = contracts;

  const ticketPrice = await raffle.ticketPrice();

  await raffle.connect(albert).enterWithEth({value: ticketPrice})

  expect(await players()).to.include(await albert.getAddress());
});

  // rejects when raffle is not active
scenario.only("enterWithEth rejects incorrect ticketPrice", {}, async ({actors, contracts}, world) => {
  const { albert } = actors;
  const { raffle } = contracts;

  const ticketPrice = await raffle.ticketPrice();

  expect(
    raffle.connect(albert).enterWithEth({value: ticketPrice.add(1)})
  ).to.be.revertedWith("Incorrect ticket price");
});

// enterWithToken

// determineWinner
scenario.only("determineWinner can only be called by owner", {}, async ({actors, contracts}, world) => {
  const { albert } = actors;
  const { raffle } = contracts;

  expect(
    raffle.connect(albert).determineWinner()
  ).to.be.revertedWith('Only owner can determine winner');
});

  // changes raffle state

  // transfers prize money to someone


// restartRaffle

  // rejects if raffle is already active

  // rejects if not the owner

  // deletes previous players

  // resets Raffle State

  // updates ticket price