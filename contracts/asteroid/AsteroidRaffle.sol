//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

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
contract AsteroidRaffle is Initializable {

    enum RaffleState { Active, Finished }
    RaffleState public state;

    // Raffle governor
    address public immutable governor;
    // Accept payment in this token as well in addition to Eth
    Token public immutable token;
    // Allows to get price of eth in tokens
    Oracle public immutable oracle;
    // Ticket price in wei
    uint public ticketPrice;
    // Raffle end time
    uint public endTime;
    // All current round participants
    address[] public players;
    // Used for upgradability initialize function
    bool public initialized = false;

    /*** Events ***/
    event NewPlayer(bool isToken, address participant, uint ticketPrice);
    event NewWinner(address winner, uint ethPrizeAmount, uint tokenPrizeAmount);
    event RaffleRestarted(address governor, uint ticketPrice, uint endTime);

    // @dev You must call `initialize()` after construction
    constructor(Token token_, Oracle oracle_) {
        governor = msg.sender;
        token = token_;
        oracle = oracle_;
    }

    function initialize(uint ticketPrice_, uint duration_) public initializer {
        require(initialized == false, "Raffle already initialized");

        // Save raffle parameters and state
        state = RaffleState.Active;
        ticketPrice = ticketPrice_;
        endTime = block.timestamp + duration_;

        initialized = true;
    }

    function enterWithEth() external payable {
        require(state == RaffleState.Active, "Raffle is not active");
        require(msg.value == ticketPrice, "Incorrect ticket price");

        // Add player to the raffle
        players.push(msg.sender);

        emit NewPlayer(false, msg.sender, ticketPrice);
    }

    function enterWithToken() external {
        require(state == RaffleState.Active, "Raffle is not active");
        uint tokenTicketPrice = (ticketPrice * oracle.getEthPriceInTokens()) / 1e18;
        require(token.transferFrom(msg.sender, address(this), tokenTicketPrice), "Token transfer failed");

        // Add player to the raffle
        players.push(msg.sender);

        emit NewPlayer(true, msg.sender, tokenTicketPrice);
    }

    function determineWinner() external {
        require(state == RaffleState.Active, "Raffle is already finished");
        require(msg.sender == governor, "Only owner can end raffle");
        require(block.timestamp > endTime, "Raffle time is not over yet");
        // Finish the raffle
        state = RaffleState.Finished;
        // Pseudo-randomly pick a winner
        address winner = players[random() % players.length];

        // Distribute Eth prize pool to the winner
        uint ethPrizeAmount = address(this).balance;
        payable(winner).transfer(ethPrizeAmount);
        // (bool sent, bytes memory data) = winner.call{value: ethPrizeAmount}("");
        // require(sent, "Failed to send Ether");

        // Distribute token prize pool to the winner
        uint tokenPrizeAmount = token.balanceOf(address(this));
        require(token.transfer(winner, tokenPrizeAmount), "Token transfer failed");

        emit NewWinner(winner, ethPrizeAmount, tokenPrizeAmount);
    }

    function restartRaffle(uint newTicketPrice, uint newDuration) external {
        require(state == RaffleState.Finished, "Raffle is still active");
        require(msg.sender == governor, "Only owner can restart raffle");

        // Update raffle parameters and state
        state = RaffleState.Active;
        ticketPrice = newTicketPrice;
        endTime = block.timestamp + newDuration;

        // Delete previous players
        delete players;

        emit RaffleRestarted(governor, ticketPrice, endTime);
    }

    function random() internal view returns (uint) {
        return uint(keccak256(abi.encodePacked(block.difficulty, block.timestamp, players)));
    }
}