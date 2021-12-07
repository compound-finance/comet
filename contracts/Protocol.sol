//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;


contract Protocol {

    // 256 bits total
	struct Supply {
		uint72 totalSupplyBase;
		uint64 baseSupplyIndex;
		uint96 trackingSupplyIndex;
		uint8 pauseFlags;
		uint16 lastAccrualTime;
	}

    // 256 bits total
	struct Borrow {
		uint72 totalBorrowBase;
		uint64 baseBorrowIndex;
		uint96 trackingBorrowIndex;
		uint24 lastAccrualTime;
	}
	mapping(address => mapping(address => bool)) public isPermitted;

	// 232 bits, maybe let's add more bits to fields here?
	struct User {
		int72 userPrincipal;
		uint96 userBaseTrackingIndex;
	    uint48 userBaseTrackingAccrued;
		uint16 userAssets;
	}
	mapping(address => User) public users;

	struct Asset {
		uint128 totalCollateral;
		uint128 collateralTrackingIndex;
	}
	mapping(address => Asset) public assets;

	mapping (address => uint) public userNonce;

}