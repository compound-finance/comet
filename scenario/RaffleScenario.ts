import { scenario } from "./CometContext";
import { expect } from "chai";
import { RaffleState } from "./constraints/RaffleStateConstraint";
import { BigNumber } from "ethers";
import { World } from "../plugins/scenario";
import { RaffleTime } from "./constraints/RaffleTimeConstraint";

const TOKEN_BASE = 1e18.toString();

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

    await expect(
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
    const ticketPriceInTokens = ticketPrice.mul(ethPrice).div(BigNumber.from(TOKEN_BASE));
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
    const ticketPriceInTokens = ticketPrice.mul(ethPrice).div(BigNumber.from(TOKEN_BASE));

    await expect(albert.enterWithToken(ticketPriceInTokens.sub(1))).to.be.reverted;
  }
);

scenario(
  "enterWithToken > fails when raffle is finished",
  {
    raffle: {
      state: RaffleState.Finished
    }
  },
  async ({ actors, contracts }, world: World) => {
    const { betty } = actors;
    const { raffle, oracle } = contracts();

    const ticketPrice = await raffle.ticketPrice();
    const ethPrice  = await oracle.getEthPriceInTokens();
    // Calculate ticket price in tokens
    const ticketPriceInTokens = ticketPrice.mul(ethPrice).div(BigNumber.from(TOKEN_BASE));

    await expect(
      betty.enterWithToken(ticketPriceInTokens)
    ).to.be.revertedWith("Raffle is not active");
  }
);

scenario(
  "determineWinner > can only be called by owner",
  {},
  async ({ actors }) => {
    const { albert } = actors;

    await expect(albert.determineWinner()).to.be.revertedWith(
      "Only owner can end raffle"
    );
  }
);

scenario(
  "determineWinner > changes raffle state",
  {
    raffle: {
      minEntries: 1,
      state: RaffleState.Active,
      time: RaffleTime.Over
    }
  },
  async ({ actors, contracts }, world: World) => {
    const { admin } = actors;
    const { raffle } = contracts();

    await admin.determineWinner();

    expect(await raffle.state()).to.equal(RaffleState.Finished);
  }
);

scenario(
  "determineWinner > transfers prize money to winner",
  {
    raffle: {
      state: RaffleState.Active,
      time: RaffleTime.Over
    }
  },
  async ({ actors, contracts }, world: World) => {
    const { admin, betty, albert, charles} = actors;
    const { raffle, oracle } = contracts();

    // Albert and Betty enter raffle with ETH
    const ticketPrice = await raffle.ticketPrice();
    await albert.enterWithEth(ticketPrice);
    await betty.enterWithEth(ticketPrice);

    // Charles enters raffle with token
    const ethPrice  = await oracle.getEthPriceInTokens();
    const ticketPriceInTokens = ticketPrice.mul(ethPrice).div(BigNumber.from(TOKEN_BASE));
    await charles.enterWithToken(ticketPriceInTokens);

    // Eth and token balances of all players before the end of current raffle
    const ethBalancesBefore = {
      'charles': await charles.getEthBalance(),
      'betty': await betty.getEthBalance(),
      'albert': await albert.getEthBalance()
    };
    const tokenBalancesBefore = {
      'charles': await charles.getTokenBalance(),
      'betty': await betty.getTokenBalance(),
      'albert': await albert.getTokenBalance()
    };

    // Determine winner and get `NewWinner` event data
    const [winner, ethPrize, tokenPrize] = await admin.determineWinner('NewWinner');
    const winnerName = winner == await charles.getAddress() ? 'charles' : winner == await betty.getAddress() ? 'betty' : 'albert';

    // Eth and token balances of all players after the end of current raffle
    const ethBalancesAfter = {
      'charles': await charles.getEthBalance(),
      'betty': await betty.getEthBalance(),
      'albert': await albert.getEthBalance()
    };
    const tokenBalancesAfter = {
      'charles': await charles.getTokenBalance(),
      'betty': await betty.getTokenBalance(),
      'albert': await albert.getTokenBalance()
    };

    // Check that winner is one of the players
    expect(winner == await albert.getAddress() || winner == await betty.getAddress() || winner == await charles.getAddress()).to.equal(true);

    // Check that winner received eth and token prizes
    expect(ethBalancesAfter[winnerName]).to.equal(ethBalancesBefore[winnerName].add(ethPrize));
    expect(tokenBalancesAfter[winnerName]).to.equal(tokenBalancesBefore[winnerName].add(tokenPrize));

    expect(ethPrize).to.equal(ticketPrice.mul(2))
    expect(tokenPrize).to.equal(ticketPriceInTokens);

    expect(await raffle.state()).to.equal(RaffleState.Finished);
  }
);

scenario(
  "determineWinner > rejects if raffle time is not over yet",
  {
    raffle: {
      time: RaffleTime.NotOver,
      state: RaffleState.Active
    }
  },
  async ({ actors }) => {
    const { admin } = actors;

    await expect(admin.determineWinner()).to.be.revertedWith(
      "Raffle time is not over yet"
    );
  }
);

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