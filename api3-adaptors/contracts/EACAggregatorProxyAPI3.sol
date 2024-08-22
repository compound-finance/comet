// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@api3/contracts/api3-server-v1/proxies/interfaces/IProxy.sol";
import "./IPriceFeed.sol";

contract EACAggregatorProxy is IPriceFeed {

   // Updating the proxy address is a security-critical action which is why
   // we have made it immutable.
   address public immutable proxy;

   constructor(address _proxy) {
       proxy = _proxy;
   }
   
   function description() external pure override returns (string memory) {
       return "API3 Adapter";
   }

   function aggregator() external view returns (address) {
       return address(proxy);
   }
   
   function latestRoundData() external view
       returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
          (answer,updatedAt) = readDataFeed();
          startedAt = updatedAt;
          roundId = 2;
          answeredInRound = 2;
    }
    
   function latestRound() external view returns (uint256 roundId) {
       roundId = 2;
   }
    
   function getRoundData(uint80 _roundId) external view
       returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
          (answer,updatedAt) = readDataFeed();
          startedAt = updatedAt;
          roundId = 2;
          answeredInRound = 2;
    }

   function latestAnswer() external view returns (int256 value) {
       (value, ) = readDataFeed();
   }

   function latestTimestamp() external view returns (uint256 timestamp) {
       ( , timestamp) = readDataFeed();
   }
   
   function decimals() external view returns (uint8) {
       return 8;
   }
   
   function version() external view returns(uint256){
       return 4;
    }

   // for 8 decimals

   function readDataFeed()
       internal
       view
       returns (int224 value, uint256 timestamp)
   {
       (value, timestamp) = IProxy(proxy).read();
       int256 _value = int256(value) / 10**10;
       value = int224(_value);
   }       

   function getTokenType() external pure returns (uint256) {
       return 1;
   }    
}