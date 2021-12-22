import { scenario } from "./CometContext";
import { expect } from "chai";
import { RaffleState } from "./constraints/RaffleStateConstraint";

scenario(
  "enterWithEth > a player can enter via enterWithEth",
  {
    raffle: {
      state: RaffleState.Active
    }
  },
  async ({ actors, contracts, players }) => {
    const { albert } = actors;
    const { raffle } = contracts();

    const ticketPrice = await raffle.ticketPrice();

    await albert.enterWithEth(ticketPrice);

    expect(await players()).to.include(await albert.getAddress());
  }
);

scenario(
  "enterWithEth > fails when raffle is finished",
  {
    raffle: {
      minEntries: 1, // ending a raffle currently requires at least one entry
      state: RaffleState.Finished
    }
  },
  async ({ actors, contracts }) => {
    const { betty } = actors;
    const { raffle } = contracts();

    const ticketPrice = await raffle.ticketPrice();

    await expect(
      betty.enterWithEth(ticketPrice)
    ).to.be.revertedWith("Raffle is not active");
  }
);

scenario(
  "enterWithEth > rejects incorrect ticketPrice",
  {},
  async ({ actors, contracts }) => {
    const { albert } = actors;
    const { raffle } = contracts();

    const ticketPrice = await raffle.ticketPrice();

    expect(
      albert.enterWithEth(ticketPrice.add(1))
    ).to.be.revertedWith("Incorrect ticket price");
  }
);

// TODO: enterWithToken

scenario(
  "determineWinner > can only be called by owner",
  {},
  async ({ actors }) => {
    const { albert } = actors;

    expect(albert.determineWinner()).to.be.revertedWith(
      "Only owner can determine winner"
    );
  }
);

scenario(
  "determineWinner > changes raffle state",
  {
    raffle: {
      minEntries: 1,
      state: RaffleState.Active
    }
  },
  async ({ actors, contracts }) => {
    const { admin } = actors;
    const { raffle } = contracts();

    await admin.determineWinner();

    expect(await raffle.state()).to.equal(RaffleState.Finished);
  }
);

// TODO: test determineWinner > transfers prize money to someone

scenario(
  "restartRaffle > rejects if raffle is active",
  {
    raffle: {
      state: RaffleState.Active
    }
  },
  async ({ contracts }) => {
    const { raffle } = contracts();

    const newTicketPrice = 1;

    await expect(raffle.restartRaffle(newTicketPrice)).to.be.revertedWith(
      "Raffle is already active"
    );
  }
);

scenario(
  "restartRaffle > rejects if caller is not the owner",
  {
    raffle: {
      minEntries: 1, // ending a Raffle currently requires at least one entry
      state: RaffleState.Finished
    }
  },
  async ({ actors, contracts }) => {
    const { albert } = actors;
    const { raffle } = contracts();

    const newTicketPrice = 1;

    await expect(
      albert.restartRaffle(newTicketPrice)
    ).to.be.revertedWith("Only owner can restart raffle");
  }
);

scenario(
  "restartRaffle > delete previous players",
  {
    raffle: {
      minEntries: 1, // ending a Raffle currently requires at least one entry
      state: RaffleState.Finished
    }
  },
  async ({ actors, contracts, players }) => {
    const { admin } = actors;
    const { raffle } = contracts();

    expect(await players()).to.not.be.empty;

    const newTicketPrice = 1;
    await admin.restartRaffle(newTicketPrice);

    expect(await players()).to.be.empty;
  }
);

scenario.only(
  "restartRaffle > resets raffle state",
  {
    raffle: {
      minEntries: 1, // ending a Raffle currently requires at least one entry
      state: RaffleState.Finished
    }
  },
  async ({ actors, contracts }) => {
    const { admin } = actors;
    const { raffle } = contracts();

    expect(await raffle.state()).to.equal(RaffleState.Finished);

    // restart raffle
    const newTicketPrice = 1;
    await admin.restartRaffle(newTicketPrice);

    expect(await raffle.state()).to.equal(RaffleState.Active);
  }
);

scenario(
  "restartRaffle > updates ticket price",
  {
    raffle: {
      minEntries: 1,
      state: RaffleState.Finished
    }
  },
  async ({ actors, contracts }) => {
    const { admin } = actors;
    const { raffle } = contracts();

    const ticketPrice = await raffle.ticketPrice();
    const newTicketPrice = ticketPrice.add(1);

    // restart raffle
    await admin.restartRaffle(newTicketPrice);

    expect(await raffle.ticketPrice()).to.equal(newTicketPrice);
  }
);