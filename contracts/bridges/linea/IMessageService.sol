pragma solidity ^0.8.19;

interface IMessageService {
  function sender() external view returns (address);
}
