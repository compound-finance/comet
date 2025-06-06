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
    uint256 public constant STREAM_AMOUNT = 700_000e6;
    /// @notice The duration of the stream in seconds
    uint256 public constant STREAM_DURATION = 60 days;
    /// @notice The slippage for the COMP oracle price
    uint256 public constant SLIPPAGE = 5e5; // 0.5%
    /// @notice The slippage scale factor
    uint256 public constant SLIPPAGE_SCALE = 1e8; // 100%

    /// @notice The beginning timestamp of the stream
    uint256 public startTimestamp;
    /// @notice The timestamp of the last claim
    uint256 public lastClaimTimestamp;
    /// @notice The number of decimals for the COMP oracle
    uint256 public immutable compOracleDecimals;
    /// @notice The number of decimals for the USDC oracle
    uint256 public immutable usdcOracleDecimals;
    /// @notice The address of the receiver of the streamed USDC
    address public immutable receiver;

    /// @notice The amount of USDC supplied to the receiver
    uint256 public suppliedAmount;

    /// @notice The amount of COMP tokens claimed by the receiver
    /// @dev This variable is used to keep track of the amount of COMP tokens claimed by the receiver
    uint256 public claimedCompAmount;

    event Claimed(uint256 compAmount, uint256 usdcAmount);
    event Swept(uint256 amount);
    event Initialized();

    error ZeroAmount();
    error NotReceiver();
    error ZeroAddress();
    error InvalidPrice();
    error OnlyTimelock();
    error TransferFailed();
    error NotInitialized();
    error NotEnoughBalance();
    error StreamNotFinished();
    error AlreadyInitialized();

    modifier isInitialized() {
        if(startTimestamp == 0) revert NotInitialized();
        _;
    }

    constructor(address _receiver) {
        if(_receiver == address(0)) revert ZeroAddress();

        compOracleDecimals = AggregatorV3Interface(COMP_ORACLE).decimals();
        usdcOracleDecimals = AggregatorV3Interface(USDC_ORACLE).decimals();
        receiver = _receiver;
    }

    /// @notice Initializes the contract and sets the start timestamp
    function initialize() external {
        if(startTimestamp != 0) revert AlreadyInitialized();
        if(msg.sender != COMPOUND_TIMELOCK) revert OnlyTimelock();
        startTimestamp = block.timestamp;
        lastClaimTimestamp = block.timestamp;

        // expect that comp balance is enough to cover the stream amount
        uint256 compBalance = ERC20(COMP).balanceOf(address(this));
        if(calculateUsdcAmount(compBalance) < STREAM_AMOUNT) revert NotEnoughBalance();

        emit Initialized();
    }

    /// @notice Claims the owed amount of COMP tokens and updates the supplied amount
    function claim() external isInitialized {
        // Check if the caller is the receiver
        // and allow anyone to claim if the last claim was more than 7 days ago
        if(
            msg.sender != receiver && 
            block.timestamp < lastClaimTimestamp + 7 days
        ) revert NotReceiver();

        uint256 owed = getAmountOwed();
        if(owed == 0) revert ZeroAmount();

        uint256 compAmount = calculateCompAmount(owed);
        if(compAmount == 0) revert ZeroAmount();

        uint256 balance = ERC20(COMP).balanceOf(address(this));
        if(balance < compAmount) {
            compAmount = balance;
            owed = calculateUsdcAmount(balance);
        }

        lastClaimTimestamp = block.timestamp;
        suppliedAmount += owed;
        claimedCompAmount += compAmount;

        emit Claimed(compAmount, owed);
        if(!ERC20(COMP).transfer(receiver, compAmount)) revert TransferFailed();
    }

    /// @notice Allows COMP tokens to be swept from the contract after the stream has ended
    /// @dev This function can only be called after the stream has ended and the remaining balance is transferred to the Compound Comptroller
    function sweepRemaining() external isInitialized {
        // anyone can sweep the remaining balance after the stream has ended
        // but only timelock can sweep before that
        if(
            msg.sender != COMPOUND_TIMELOCK &&
            block.timestamp < startTimestamp + STREAM_DURATION + 10 days
        ) revert StreamNotFinished();
        uint256 remainingBalance = ERC20(COMP).balanceOf(address(this));
        emit Swept(remainingBalance);
        if(!ERC20(COMP).transfer(COMPTROLLER, remainingBalance)) revert TransferFailed();
    }

    /// @notice Calculates the amount owed to the receiver based on the elapsed time since the start of the stream minus the supplied amount
    /// @return owed The amount owed to the receiver in USDC
    function getAmountOwed() public view returns(uint256) {
        if(suppliedAmount >= STREAM_AMOUNT) {
            return 0;
        }

        if(block.timestamp < startTimestamp + STREAM_DURATION) {
            uint256 elapsed = block.timestamp - startTimestamp;
            uint256 totalOwed = (STREAM_AMOUNT * elapsed) / STREAM_DURATION;
            return totalOwed - suppliedAmount;
        } else {
            return STREAM_AMOUNT - suppliedAmount;
        }
    }

    /// @notice Calculates the amount of COMP tokens needed to cover the owed amount in USD
    /// @param amount The amount in USDC to be converted to COMP
    /// @return The amount of COMP tokens needed to cover the owed amount in USD
    /// @dev This function uses Chainlink oracles to get the latest prices of COMP and USDC
    function calculateCompAmount(uint256 amount) public view returns (uint256) {
        (, int256 compPrice, , , ) = AggregatorV3Interface(COMP_ORACLE).latestRoundData();
        if (compPrice <= 0) revert InvalidPrice();

        (, int256 usdcPrice, , , ) = AggregatorV3Interface(USDC_ORACLE).latestRoundData();
        if (usdcPrice <= 0) revert InvalidPrice();

        // COMP price is reduced by slippage to account for price fluctuations
        uint256 compPriceScaled = scaleAmount(uint256(compPrice), compOracleDecimals, 18) * (SLIPPAGE_SCALE - SLIPPAGE) / SLIPPAGE_SCALE;
        uint256 usdcPriceScaled = scaleAmount(uint256(usdcPrice), usdcOracleDecimals, 18);

        uint256 amountInUSD = (scaleAmount(amount, 6, 18) * usdcPriceScaled) / 1e18;
        uint256 amountInCOMP = (amountInUSD * 1e18) / compPriceScaled;
        return amountInCOMP;
    }

    /// @notice Calculates the amount of USDC needed to cover the owed amount in COMP
    /// @param amount The amount in COMP to be converted to USDC
    /// @return The amount of USDC needed to cover the owed amount in COMP
    /// @dev This function uses Chainlink oracles to get the latest prices of COMP and USDC
    function calculateUsdcAmount(uint256 amount) public view returns (uint256) {
        (, int256 compPrice, , , ) = AggregatorV3Interface(COMP_ORACLE).latestRoundData();
        if (compPrice <= 0) revert InvalidPrice();

        (, int256 usdcPrice, , , ) = AggregatorV3Interface(USDC_ORACLE).latestRoundData();
        if (usdcPrice <= 0) revert InvalidPrice();

        // COMP price is reduced by slippage to account for price fluctuations
        uint256 compPriceScaled = scaleAmount(uint256(compPrice), compOracleDecimals, 18) * (SLIPPAGE_SCALE - SLIPPAGE) / SLIPPAGE_SCALE;
        uint256 usdcPriceScaled = scaleAmount(uint256(usdcPrice), usdcOracleDecimals, 18);

        uint256 amountInUSD = (amount * compPriceScaled) / 1e18;
        uint256 amountInUSDC = (amountInUSD * 1e6) / usdcPriceScaled;
        return amountInUSDC;
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
