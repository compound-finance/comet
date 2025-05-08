// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import { AggregatorV3Interface } from "./vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { ERC20 } from "./ERC20.sol";

/// @title Streamer
/// @notice This contract streams a fixed amount of USDC to a receiver over a specified duration.
/// The contract uses Chainlink oracles to determine the amount of COMP tokens needed to cover the owed amount in USD.
/// The contract allows the receiver to claim the owed amount of COMP tokens and also allows for the remaining balance to be swept after the stream has ended.
contract Streamer {
    /// @notice The address of the Chainlink oracle for COMP
    address public constant COMP_ORACLE = 0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5;
    /// @notice The address of the Chainlink oracle for USDC
    address public constant USDC_ORACLE = 0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6;
    /// @notice The address of the Compound token (COMP)
    address public constant COMP = 0xc00e94Cb662C3520282E6f5717214004A7f26888;

    /// @notice The address of the Compound comptroller
    /// @dev This address is used to transfer the remaining balance after the stream has ended
    address public constant COMPTROLLER = 0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B;

    /// @notice The address of the Compound timelock
    /// @dev This address is used to initialize the contract and can only be called by the timelock
    address public constant COMPOUND_TIMELOCK = 0x6d903f6003cca6255D85CcA4D3B5E5146dC33925;

    /// @notice The amount of USDC to be streamed
    uint256 public constant STREAM_AMOUNT = 2_000_000e6;
    /// @notice The duration of the stream in seconds
    uint256 public constant STREAM_DURATION = 365 days;

    /// @notice The beginning timestamp of the stream
    uint256 public startTimestamp;
    /// @notice The number of decimals for the COMP oracle
    uint256 public immutable compOracleDecimals;
    /// @notice The number of decimals for the USDC oracle
    uint256 public immutable usdcOracleDecimals;
    /// @notice The address of the receiver of the streamed USDC
    address public immutable receiver;

    /// @notice The amount of USDC supplied to the contract
    uint256 public suppliedAmount;

    /// @notice The amount of COMP tokens claimed by the receiver
    /// @dev This variable is used to keep track of the amount of COMP tokens claimed by the receiver
    uint256 public claimedCompAmount;
    /// @notice The last timestamp when the receiver claimed the owed amount
    uint256 public lastClaimTime;

    event Claimed(uint256 compAmount, uint256 usdcAmount);
    event Swept(uint256 amount);
    event Initialized();

    modifier isInitialized() {
        require(startTimestamp != 0, "Not initialized");
        _;
    }

    constructor(address _receiver) {
        require(_receiver != address(0), "Receiver cannot be zero address");
        compOracleDecimals = AggregatorV3Interface(COMP_ORACLE).decimals();
        usdcOracleDecimals = AggregatorV3Interface(USDC_ORACLE).decimals();
        receiver = _receiver;
    }

    /// @notice Initializes the contract and sets the start timestamp
    function initialize() external {
        require(msg.sender == COMPOUND_TIMELOCK, "Only timelock can initialize");
        startTimestamp = block.timestamp;
        lastClaimTime = block.timestamp;
        emit Initialized();
    }

    /// @notice Claims the owed amount of COMP tokens and updates the supplied amount
    function claim() external isInitialized {
        require(msg.sender == receiver, "Only receiver can claim");
        uint256 owed = getAmountOwed();
        require(owed > 0, "No amount owed");
        uint256 compAmount = calculateCompAmount(owed);
        require(compAmount > 0, "No COMP amount needed");
        require(ERC20(COMP).transfer(receiver, compAmount), "Transfer failed");
        lastClaimTime = block.timestamp;
        suppliedAmount += owed;
        claimedCompAmount += compAmount;
        emit Claimed(compAmount, owed);
    }

    /// @notice Allows tokens to be swept from the contract after the stream has ended
    /// @dev This function can only be called after the stream has ended and the remaining balance is transferred to the Compound timelock
    function sweepRemaining() external isInitialized {
        require(block.timestamp > startTimestamp + STREAM_DURATION + 10 days, "Stream not finished");
        uint256 remainingBalance = ERC20(COMP).balanceOf(address(this));
        emit Swept(remainingBalance);
        require(ERC20(COMP).transfer(COMPTROLLER, remainingBalance), "Transfer failed");
    }

    /// @notice Calculates the amount owed to the receiver based on the elapsed time since the last claim
    /// @return owed The amount owed to the receiver in USDC
    function getAmountOwed() public view returns(uint256 owed) {
        if(suppliedAmount >= STREAM_AMOUNT) {
            return 0;
        }
        uint256 elapsed = block.timestamp - lastClaimTime;
        uint256 totalOwed = (STREAM_AMOUNT * elapsed) / STREAM_DURATION;

        if (totalOwed > suppliedAmount) {
            return totalOwed - suppliedAmount;
        } else {
            return 0;
        }
    }

    /// @notice Calculates the amount of COMP tokens needed to cover the owed amount in USD
    /// @param amount The amount in USDC to be converted to COMP
    /// @return The amount of COMP tokens needed to cover the owed amount in USD
    /// @dev This function uses Chainlink oracles to get the latest prices of COMP and USDC
    function calculateCompAmount(uint256 amount) public view returns (uint256) {
        (, int256 compPrice, , , ) = AggregatorV3Interface(COMP_ORACLE).latestRoundData();
        require(compPrice > 0, "Invalid COMP price");

        (, int256 usdcPrice, , , ) = AggregatorV3Interface(USDC_ORACLE).latestRoundData();
        require(usdcPrice > 0, "Invalid USDC price");

        uint256 compPriceScaled = scaleAmount(uint256(compPrice), compOracleDecimals, 18);
        uint256 usdcPriceScaled = scaleAmount(uint256(usdcPrice), usdcOracleDecimals, 18);
        uint256 amountInUSD = (scaleAmount(amount, 6, 18) * 1e18) / usdcPriceScaled;
        uint256 amountInCOMP = (amountInUSD * 1e18) / compPriceScaled;
        return amountInCOMP;
    }

    /// @notice Scales an amount from one decimal representation to another
    /// @param amount The amount to be scaled
    /// @param fromDecimals The number of decimals of the original amount
    /// @param toDecimals The number of decimals of the target amount
    /// @return The scaled amount
    function scaleAmount(uint256 amount, uint256 fromDecimals, uint256 toDecimals) internal pure returns (uint256) {
        // can overflow but toDecimals is always 18
        // and fromDecimals is always 6 or 8
        if (fromDecimals > toDecimals) {
            return amount / (10 ** (fromDecimals - toDecimals));
        } else {
            return amount * (10 ** (toDecimals - fromDecimals));
        }
    }
}
