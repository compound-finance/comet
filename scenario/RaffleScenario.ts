import { scenario } from "./Context";
import { expect } from "chai";

enum RaffleState {
  Active = 0,
  Finished = 1,
}

scenario(
  "enterWithEth > a player can enter via enterWithEth",
  {},
  async ({ actors, contracts, players }) => {
    const { albert } = actors;
    const { raffle } = contracts;

    const ticketPrice = await raffle.ticketPrice();

    await raffle.connect(albert).enterWithEth({ value: ticketPrice });

    expect(await players()).to.include(await albert.getAddress());
  }
);

scenario(
  "enterWithEth > fails when raffle is inactive",
  {},
  async ({ actors, contracts }) => {
    const { admin, albert, betty } = actors;
    const { raffle } = contracts;

    const ticketPrice = await raffle.ticketPrice();

    // enter one player into the raffle
    await raffle.connect(albert).enterWithEth({ value: ticketPrice });

    // end raffle
    await raffle.connect(admin).determineWinner();

    expect(
      raffle.connect(betty).enterWithEth({ value: ticketPrice })
    ).to.be.revertedWith("Raffle is not active");
  }
);

scenario(
  "enterWithEth > rejects incorrect ticketPrice",
  {},
  async ({ actors, contracts }) => {
    const { albert } = actors;
    const { raffle } = contracts;

    const ticketPrice = await raffle.ticketPrice();

    expect(
      raffle.connect(albert).enterWithEth({ value: ticketPrice.add(1) })
    ).to.be.revertedWith("Incorrect ticket price");
  }
);

// TODO: enterWithToken

scenario(
  "determineWinner > can only be called by owner",
  {},
  async ({ actors, contracts }) => {
    const { albert } = actors;
    const { raffle } = contracts;

    expect(raffle.connect(albert).determineWinner()).to.be.revertedWith(
      "Only owner can determine winner"
    );
  }
);

scenario(
  "determineWinner > changes raffle state",
  {},
  async ({ actors, contracts }) => {
    const { admin, albert, betty } = actors;
    const { raffle } = contracts;

    // enter one player into the raffle
    const ticketPrice = await raffle.ticketPrice();
    await raffle.connect(albert).enterWithEth({ value: ticketPrice });

    expect(await raffle.state()).to.equal(RaffleState.Active);

    // end raffle
    await raffle.connect(admin).determineWinner();

    expect(await raffle.state()).to.equal(RaffleState.Finished);
  }
);

// TODO: test determineWinner > transfers prize money to someone

scenario(
  "restartRaffle > rejects if raffle is active",
  {},
  async ({ contracts }) => {
    const { raffle } = contracts;
    const newTicketPrice = 1;
    expect(raffle.restartRaffle(newTicketPrice)).to.be.revertedWith(
      "Raffle is already active"
    );
  }
);

scenario(
  "restartRaffle > rejects if caller is not the owner",
  {},
  async ({ actors, contracts }) => {
    const { admin, albert } = actors;
    const { raffle } = contracts;

    // enter one player into the raffle
    const ticketPrice = await raffle.ticketPrice();
    await raffle.connect(albert).enterWithEth({ value: ticketPrice });

    // end raffle
    await raffle.connect(admin).determineWinner();

    expect(
      raffle.connect(albert).restartRaffle(ticketPrice)
    ).to.be.revertedWith("Only owner can restart raffle");
  }
);

scenario(
  "restartRaffle > delete previous players",
  {},
  async ({ actors, contracts, players }) => {
    const { admin, albert } = actors;
    const { raffle } = contracts;

    // enter one player into the raffle
    const ticketPrice = await raffle.ticketPrice();
    await raffle.connect(albert).enterWithEth({ value: ticketPrice });

    // end raffle
    await raffle.connect(admin).determineWinner();
    // restart raffle
    await raffle.connect(admin).restartRaffle(ticketPrice);

    expect(await players()).to.be.empty;
  }
);

scenario(
  "restartRaffle > resets raffle state",
  {},
  async ({ actors, contracts }) => {
    const { admin, albert } = actors;
    const { raffle } = contracts;

    // enter one player into the raffle
    const ticketPrice = await raffle.ticketPrice();
    await raffle.connect(albert).enterWithEth({ value: ticketPrice });

    // end raffle
    await raffle.connect(admin).determineWinner();

    expect(await raffle.state()).to.equal(RaffleState.Finished);

    // restart raffle
    await raffle.connect(admin).restartRaffle(ticketPrice);

    expect(await raffle.state()).to.equal(RaffleState.Active);
  }
);

scenario(
  "restartRaffle > updates ticket price",
  {},
  async ({ actors, contracts }) => {
    const { admin, albert } = actors;
    const { raffle } = contracts;

    // enter one player into the raffle
    const ticketPrice = await raffle.ticketPrice();
    await raffle.connect(albert).enterWithEth({ value: ticketPrice });

    // end raffle
    await raffle.connect(admin).determineWinner();

    const newTicketPrice = ticketPrice.add(1);

    // restart raffle
    await raffle.connect(admin).restartRaffle(newTicketPrice);

    expect(await raffle.ticketPrice()).to.equal(newTicketPrice);
  }
);