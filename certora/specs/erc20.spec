////////////////////////////////////////////////////////////////////////////////
/////////////////////////   Methods Summarizations   ///////////////////////////
////////////////////////////////////////////////////////////////////////////////
//
// erc20 methods - summarization to the implementation of ERC20 contract
methods {
    name()                                returns (string)  => DISPATCHER(true) 
    symbol()                              returns (string)  => DISPATCHER(true) 
    decimals()                            returns (string)  => DISPATCHER(true) 
    totalSupply()                         returns (uint256) => DISPATCHER(true) 
    balanceOf(address)                    returns (uint256) => DISPATCHER(true) 
    allowance(address,address)            returns (uint)    => DISPATCHER(true) 
    approve(address,uint256)              returns (bool)    => DISPATCHER(true) 
    transfer(address,uint256)             returns (bool)    => DISPATCHER(true) 
    transferFrom(address,address,uint256) returns (bool)    => DISPATCHER(true) 
}