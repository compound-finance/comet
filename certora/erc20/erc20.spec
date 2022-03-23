// erc20 methods - summarization to the implementation of ERC20 contract
methods {
    totalSupply()                         returns (uint256)   envfree
    balanceOf(address)                    returns (uint256)   envfree
    allowance(address,address)            returns (uint)      envfree
}

/*
    @Rule


    @Description:
        Verify that there is no fee on transferFrom() (like potentially on USDT)

    @Formula:
        {
            balances[bob] = y
            allowance(alice, msg.sender) >= amount
        }
        <
            transferFrom(alice, bob, amount)
        >
        {
            balances[bob] = y + amount
        }

    @Notes:


    @Link:

*/
rule noFeeOnTransferFrom(address alice, address bob, uint256 amount) {
    env e;
    calldataarg args;
    require alice != bob;
    require allowance(alice, e.msg.sender) >= amount;
    uint256 balanceBefore = balanceOf(bob);

    transferFrom(e, alice, bob, amount);

    uint256 balanceAfter = balanceOf(bob);
    assert balanceAfter == balanceBefore + amount;
}

/*
    @Rule

    @Description:
        Verify that there is no fee on transfer() (like potentially on USDT)

    @Formula:
        {
            balances[bob] = y
            balances[msg.sender] >= amount
        }
        <
            transfer(bob, amount)
        >
        {
            balances[bob] = y + amount
        }
    
    @Notes:
    
    @Link:


*/
rule noFeeOnTransfer(address bob, uint256 amount) {
    env e;
    calldataarg args;
    require bob != e.msg.sender;
    uint256 balanceSenderBefore = balanceOf(e.msg.sender);
    uint256 balanceBefore = balanceOf(bob);

    transfer(e, bob, amount);

    uint256 balanceAfter = balanceOf(bob);
    uint256 balanceSenderAfter = balanceOf(e.msg.sender);
    assert balanceAfter == balanceBefore + amount;
}
