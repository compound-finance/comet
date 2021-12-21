import { scenario } from './Context';
import { expect } from 'chai';

scenario.only("enterWithEth > a player can enter via enterWithEth", {}, async ({actors, contracts, players}, world) => {
  const { albert } = actors;
  const { raffle } = contracts;

  const ticketPrice = await raffle.ticketPrice();

  await raffle.connect(albert).enterWithEth({value: ticketPrice})

  expect(await players()).to.include(await albert.getAddress());
});

scenario.only("enterWithEth > fails when raffle is inactive", {}, async ({actors, contracts}, world) => {
  const { admin, albert, betty } = actors;
  const { raffle } = contracts;

  const ticketPrice = await raffle.ticketPrice();

  // enter one player into the raffle
  await raffle.connect(albert).enterWithEth({value: ticketPrice})

  // end raffle
  await raffle.connect(admin).determineWinner();

  expect(
    raffle.connect(betty).enterWithEth({value: ticketPrice})
  ).to.be.revertedWith("Raffle is not active");
});

scenario.only("enterWithEth > rejects incorrect ticketPrice", {}, async ({actors, contracts}, world) => {
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
scenario.only("determineWinner > changes raffle state", {}, async ({actors, contracts}, world) => {
  const { admin, albert, betty } = actors;
  const { raffle } = contracts;

  // enter one player into the raffle
  const ticketPrice = await raffle.ticketPrice();
  await raffle.connect(albert).enterWithEth({value: ticketPrice})

  // Active = 0
  expect(await raffle.state()).to.equal(0);

  // end raffle
  await raffle.connect(admin).determineWinner();

  // Finished = 1
  expect(await raffle.state()).to.equal(1);
});

// TODO: test determineWinner > transfers prize money to someone

scenario.only("restartRaffle > rejects if raffle is active", {}, async ({actors, contracts}, world) => {
  const { raffle } = contracts;
  const newTicketPrice = 1;
  expect(
    raffle.restartRaffle(newTicketPrice)
  ).to.be.revertedWith('Raffle is already active');
});

scenario.only("restartRaffle > rejects if called is not the owner", {}, async ({actors, contracts}, world) => {
  const { admin, albert } = actors;
  const { raffle } = contracts;
  const newTicketPrice = 1;

  // enter one player into the raffle
  const ticketPrice = await raffle.ticketPrice();
  await raffle.connect(albert).enterWithEth({value: ticketPrice})

  // end raffle
  await raffle.connect(admin).determineWinner();

  expect(
    raffle.connect(albert).restartRaffle(newTicketPrice)
  ).to.be.revertedWith('Only owner can restart raffle');
});

scenario.only("restartRaffle > delete previous players", {}, async ({actors, contracts, players}, world) => {
  const { admin, albert } = actors;
  const { raffle } = contracts;

  // enter one player into the raffle
  const ticketPrice = await raffle.ticketPrice();
  await raffle.connect(albert).enterWithEth({value: ticketPrice})

  // end raffle
  await raffle.connect(admin).determineWinner();
  // restart raffle
  await raffle.connect(admin).restartRaffle(ticketPrice);

  expect(await players()).to.be.empty;
});

  // resets Raffle State

  // updates ticket price