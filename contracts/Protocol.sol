// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ConfigInterface {
    function targetReserves() external view returns (uint);
    function borrowMin() external view returns (uint);
}

contract Protocol {
	ConfigInterface immutable config;

	event Values(uint targetReserves, uint borrowMin);

	constructor(address config_) {
		config = ConfigInterface(config_);
	}

	function getData() public returns (uint, uint) {
		// Ignore success here
		(bool success1, bytes memory data1) = address(config).call(abi.encodePacked(config.targetReserves.selector));
		// Ignore success here
		(bool success2, bytes memory data2) = address(config).call(abi.encodePacked(config.borrowMin.selector));
		
		uint targetReserves = abi.decode(data1, (uint));
		uint borrowMin = abi.decode(data2, (uint));
		emit Values(targetReserves, borrowMin);
		return (targetReserves, borrowMin);
	}
}