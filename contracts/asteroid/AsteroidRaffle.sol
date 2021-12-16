//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface Token {
  function balanceOf(address) external view returns (uint);
  function transfer(address, uint) external returns (bool);
  function transferFrom(address, address, uint) external returns(bool);
}

// Let's assume token scale 1e6
interface Oracle {
  function getEthPriceInTokens() external view returns (uint);
}

// This was done as a toy contract deliberately, use cautiosly and with skepticism
contract AsteroidRaffle {

    enum RaffleState { Active, Finished }
    RaffleState public state;

    address public immutable owner;
    // Accept payment in this token as well in addition to Eth
    Token public immutable token;
    Oracle public immutable oracle;
    // Ticket price in wei
    uint public ticketPrice;
    address[] public players;

    constructor(uint ticketPrice_, Token token_, Oracle oracle_) {
        owner = msg.sender;
        state = RaffleState.Active;
        ticketPrice = ticketPrice_;
        token = token_;
        oracle = oracle_;
    }

    function enterWithEth() external payable {
        require(state == RaffleState.Active, "Raffle is not active");
        require(msg.value == ticketPrice, "Incorrect ticket price");

        players.push(msg.sender);
    }

    function enterWithToken() external {
      uint tokenTicketPrice = (ticketPrice * oracle.getEthPriceInTokens()) / 1e18;
      require(token.transferFrom(msg.sender, address(this), tokenTicketPrice), "Token transfer failed");

      players.push(msg.sender);
    }


    function determineWinner() external {
        require(msg.sender == owner, "Only owner can determine winner");
        state = RaffleState.Finished;
        address winningPlayer = players[random() % players.length];

        // Send funds to the raffle winner
        distributeFunds(winningPlayer);
    }

    function restartRaffle(uint newTicketPrice) external {
        require(state == RaffleState.Finished, "Raffle is already active");
        require(msg.sender == owner, "Only owner can restart raffle");
        state = RaffleState.Active;
        ticketPrice = newTicketPrice;

        // Delete previous players
        delete players;
    }

    function distributeFunds(address winner) internal {
        // Distribute Eth prize pool
        uint prizeAmount = address(this).balance;
        payable(winner).transfer(prizeAmount);

        // Distribute token prize pool to the winner
        token.transfer(winner, token.balanceOf(address(this)));
    }

    function random() private view returns (uint) {
      return uint(keccak256(abi.encodePacked(block.difficulty, block.timestamp, players)));
    }
}