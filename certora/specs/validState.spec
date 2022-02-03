import "comet.spec"

rule whoChanedIsBorrowCollateralized(address account, method f) {
    bool before = isBorrowCollateralized(account);
    env e;
    calldataarg args;
    f(e,args);
    assert (isBorrowCollateralized(account) == before);
}
/*
rule check_transfer(){
env e;
address	dst;
address	asset;
uint amount;

uint balanceScr_1 = userCollateral[src][asset].balance;
uint balanceDst_1 = userCollateral[dst][asset].balance;
transfer(dst,asset,amount);
uint balanceScr_2 = userCollateral[src][asset].balance;
uint balanceDst_2 = userCollateral[dst][asset].balance;

assert balanceScr_1 - balanceScr_2 == amount && balanceDst_2 - balanceDst_1 == amount;
}*/