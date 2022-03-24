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

rule TransferCorrect(address to, uint256 amount) {
    env e;
    require e.msg.value == 0;
    uint256 fromBalanceBefore = balanceOf(e.msg.sender);
    uint256 toBalanceBefore = balanceOf(to);
    require fromBalanceBefore + toBalanceBefore <= max_uint256;

    transfer@withrevert(e, to, amount);
    bool reverted = lastReverted;
    if (!reverted) {
        if (e.msg.sender == to) {
            assert balanceOf(e.msg.sender) == fromBalanceBefore;
        } else {
            assert balanceOf(e.msg.sender) == fromBalanceBefore - amount;
            assert balanceOf(to) == toBalanceBefore + amount;
        }
    } else {
        assert amount > fromBalanceBefore || to == 0;
    }
}

rule TransferFromCorrect(address from, address to, uint256 amount) {
    env e;
    require e.msg.value == 0;
    uint256 fromBalanceBefore = balanceOf(from);
    uint256 toBalanceBefore = balanceOf(to);
    uint256 allowanceBefore = allowance(from, e.msg.sender);
    require fromBalanceBefore + toBalanceBefore <= max_uint256;

    transferFrom@withrevert(e, from, to, amount);
    bool reverted = lastReverted;
    if (!reverted) {
        if (from == to) {
            assert balanceOf(from) == fromBalanceBefore;
            assert allowance(from, e.msg.sender) == allowanceBefore;
        } else {
            assert balanceOf(from) == fromBalanceBefore - amount;
            assert balanceOf(to) == toBalanceBefore + amount;
            if (allowanceBefore == max_uint256) {
                assert allowance(from, e.msg.sender) == max_uint256;
            } else {
                assert allowance(from, e.msg.sender) == allowanceBefore - amount;
            }
        }
    } else {
        assert allowanceBefore < amount || amount > fromBalanceBefore || to == 0;
    }
}

invariant ZeroAddressNoBalance()
    balanceOf(0) == 0

ghost sumOfBalances() returns uint256;

// can't test on generic ERC20 because each contract might call the variable different name

// hook Sstore balanceOf[KEY address a] uint256 balance (uint256 old_balance) STORAGE {
// 	havoc sumOfBalances assuming 
//         sumOfBalances@new() == sumOfBalances@old() + (balance - old_balance);
// }



rule NoChangeTotalSupply(method f) {
    require f.selector != burn(uint256).selector && f.selector != mint(address, uint256).selector;
    uint256 totalSupplyBefore = totalSupply();
    env e;
    calldataarg args;
    f(e, args);
    assert totalSupply() == totalSupplyBefore;
}

rule ChangingAllowance(method f, address from, address spender) {
    require f.selector != permit(address,address,uint256,uint256,uint8,bytes32,bytes32).selector;
    uint256 allowanceBefore = allowance(from, spender);
    env e;
    if (f.selector == approve(address, uint256).selector) {
        address spender_;
        uint256 amount;
        approve(e, spender_, amount);
        if (from == e.msg.sender && spender == spender_) {
            assert allowance(from, spender) == amount;
        } else {
            assert allowance(from, spender) == allowanceBefore;
        }
    } else if (f.selector == transferFrom(address,address,uint256).selector) {
        address from_;
        address to;
        address amount;
        transferFrom(e, from_, to, amount);
        uint256 allowanceAfter = allowance(from, spender);
        if (from == from_ && spender == e.msg.sender) {
            assert from == to || allowanceBefore == max_uint256 || allowanceAfter == allowanceBefore - amount;
        } else {
            assert allowance(from, spender) == allowanceBefore;
        }
    } else if (f.selector == decreaseAllowance(address, uint256).selector) {
        address spender_;
        uint256 amount;
        require amount <= allowanceBefore;
        decreaseAllowance(e, spender, amount);
        if (from == e.msg.sender && spender == spender_) {
            assert allowance(from, spender) == allowanceBefore - amount;
        } else {
            assert allowance(from, spender) == allowanceBefore;
        }
    } else if (f.selector == increaseAllowance(address, uint256).selector) {
        address spender_;
        uint256 amount;
        require amount + allowanceBefore < max_uint256;
        increaseAllowance(e, spender, amount);
        if (from == e.msg.sender && spender == spender_) {
            assert allowance(from, spender) == allowanceBefore + amount;
        } else {
            assert allowance(from, spender) == allowanceBefore;
        }
    }
    {
        calldataarg args;
        f(e, args);
        assert allowance(from, spender) == allowanceBefore;
    }
}

rule TransferSumOfFromAndToBalancesStaySame(address to, uint256 amount) {
    env e;
    mathint sum = balanceOf(e.msg.sender) + balanceOf(to);
    require sum < max_uint256;
    transfer(e, to, amount); 
    assert balanceOf(e.msg.sender) + balanceOf(to) == sum;
}

rule TransferFromSumOfFromAndToBalancesStaySame(address from, address to, uint256 amount) {
    env e;
    mathint sum = balanceOf(from) + balanceOf(to);
    require sum < max_uint256;
    transferFrom(e, from, to, amount); 
    assert balanceOf(from) + balanceOf(to) == sum;
}

rule TransferDoesntChangeOtherBalance(address to, uint256 amount, address other) {
    env e;
    require other != e.msg.sender;
    require other != to;
    uint256 balanceBefore = balanceOf(other);
    transfer(e, to, amount); 
    assert balanceBefore == balanceOf(other);
}

rule TransferFromDoesntChangeOtherBalance(address from, address to, uint256 amount, address other) {
    env e;
    require other != from;
    require other != to;
    uint256 balanceBefore = balanceOf(other);
    transferFrom(e, from, to, amount); 
    assert balanceBefore == balanceOf(other);
}

rule SumOfBalancesIsTotalSupply(method f) {
    require sumOfBalances() == totalSupply();
    require f.selector != burn(uint256).selector && f.selector != mint(address, uint256).selector;

    env e;
    if (f.selector != transfer(address, uint256).selector && f.selector != transferFrom(address, address, uint256).selector) {
        calldataarg args;
        f(e, args);
    }

    if (f.selector == transfer(address, uint256).selector) {
        address to;
        uint256 amount;
        require balanceOf(e.msg.sender) + balanceOf(to) < max_uint256;
        transfer(e, to, amount);
    }

    if (f.selector == transferFrom(address, address, uint256).selector) {
        address from;
        address to;
        uint256 amount;
        require balanceOf(from) + balanceOf(to) < max_uint256;
        transferFrom(e, from, to, amount);
    }

    assert sumOfBalances() == totalSupply();
}

rule OtherBalanceOnlyGoesUp(address other, method f) {
    // USDC functions that violate this
    require f.selector != receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32).selector &&
        f.selector != transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32).selector &&
        f.selector != initializeV2_1(address).selector;
    env e;
    // totalSupply would have already overflowed in this case, so we can assume this
    uint256 balanceBefore = balanceOf(other);

    if (f.selector == transferFrom(address, address, uint256).selector) {
        address from;
        address to;
        uint256 amount;
        require(other != from);
        require balanceOf(from) + balanceBefore < max_uint256;

        transferFrom(e, from, to, amount);
    } else if (f.selector == transfer(address, uint256).selector) {
        require other != e.msg.sender;
        require balanceOf(e.msg.sender) + balanceBefore < max_uint256;
        calldataarg args;
        f(e, args);
    } else {
        require other != e.msg.sender;
        calldataarg args;
        f(e, args);
    }

    assert balanceOf(other) >= balanceBefore;
}