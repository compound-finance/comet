pragma solidity 0.8.15;

interface IMessageService {
  function sender() external view returns (address);
}
