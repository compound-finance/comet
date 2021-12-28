import { scenario } from "./CometContext";
import { expect } from "chai";
import { RaffleState } from "./constraints/RaffleStateConstraint";
import { BigNumber } from "ethers";
import { World } from "../plugins/scenario";

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

scenario(
  "enterWithToken > a player can enter via enterWithToken",
  {
    raffle: {
      state: RaffleState.Active
    }
  },
  async ({ actors, contracts, players }) => {
    const { albert } = actors;
    const { raffle, oracle} = contracts();

    const ticketPrice = await raffle.ticketPrice();
    const ethPrice  = await oracle.getEthPriceInTokens();
    // Calculate ticket price in tokens
    const ticketPriceInTokens = ticketPrice.mul(ethPrice).div(BigNumber.from('1000000000000000000'));
    await albert.enterWithToken(ticketPriceInTokens);

    expect(await players()).to.include(await albert.getAddress());
  }
);

scenario(
  "enterWithToken > rejects incorrect ticketPrice",
  {
    raffle: {
      state: RaffleState.Active
    }
  },
  async ({ actors, contracts, players }) => {
    const { albert } = actors;
    const { raffle, oracle} = contracts();

    const ticketPrice = await raffle.ticketPrice();
    const ethPrice  = await oracle.getEthPriceInTokens();
    // Calculate ticket price in tokens
    const ticketPriceInTokens = ticketPrice.mul(ethPrice).div(BigNumber.from('1000000000000000000'));

    await expect(albert.enterWithToken(ticketPriceInTokens.sub(1))).to.be.reverted;
  }
);

// Skip for now, requires PR with time increase
scenario.skip(
  "enterWithToken > fails when raffle is finished",
  {
    raffle: {
      state: RaffleState.Finished
    }
  },
  async ({ actors, contracts }) => {
    const { betty } = actors;
    const { raffle } = contracts();

    // const ticketPrice = await raffle.ticketPrice();

    await expect(
      betty.enterWithToken(400000000)
    ).to.be.revertedWith("Raffle is not active");
  }
);

scenario(
  "determineWinner > can only be called by owner",
  {},
  async ({ actors }) => {
    const { albert } = actors;

    expect(albert.determineWinner()).to.be.revertedWith(
      "Only owner can end raffle"
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
  async ({ actors, contracts }, world: World) => {
    const { admin } = actors;
    const { raffle } = contracts();

    const endTime = (await raffle.endTime()).toNumber();
    const currentTime = await world.timestamp();

    // advance time past endtime
    if (currentTime < endTime) {
      await world.increaseTime(endTime - currentTime);
    }

    await admin.determineWinner();

    expect(await raffle.state()).to.equal(RaffleState.Finished);
  }
);

// TODO: test determineWinner > transfers prize money to someone

// TODO: test determineWinner > rejects if raffle time is not over yet

scenario(
  "restartRaffle > rejects if raffle is active",
  {
    raffle: {
      state: RaffleState.Active
    }
  },
  async ({ actors }) => {
    const { admin } = actors;

    await expect(admin.restartRaffle({ticketPrice: 1, duration: 1})).to.be.revertedWith(
      "Raffle is still active"
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
  async ({ actors }) => {
    const { albert } = actors;

    await expect(
      albert.restartRaffle({ticketPrice: 1, duration: 1})
    ).to.be.revertedWith("Only owner can restart raffle");
  }
);

scenario(
  "restartRaffle > delete previous players",
  {
    raffle: {
      minEntries: 1,
      state: RaffleState.Finished
    }
  },
  async ({ actors, players }) => {
    const { admin } = actors;

    expect(await players()).to.not.be.empty;

    await admin.restartRaffle({ticketPrice: 1, duration: 1});

    expect(await players()).to.be.empty;
  }
);

scenario(
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

    await admin.restartRaffle({
      ticketPrice: 1,
      duration: 1
    });

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

    const ticketPrice: BigNumber = await raffle.ticketPrice();
    const newTicketPrice: BigNumber = ticketPrice.add(1);

    await admin.restartRaffle({
      ticketPrice: newTicketPrice,
      duration: 1
    });

    expect(await raffle.ticketPrice()).to.equal(newTicketPrice);
  }
);