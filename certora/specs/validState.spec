import "comet.spec"

rule whoChanedIsBorrowCollateralized(address account, method f) {
    bool before = isBorrowCollateralized(account);
    env e;
    calldataarg args;
    f(e,args);
    assert (isBorrowCollateralized(account) == before);
}