if [[ "$1" ]]
then
    RULE="--rule $1"
fi

certoraRun contracts/CometExt.sol certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol certora/harness/ERC20WithCallBack.sol certora/harness/SymbolicAssetTokenB.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarness:certora/specs/cometAbsorbBuyCollateral.spec \
    --link CometHarness:baseToken=SymbolicBaseToken CometHarness:extensionDelegate=CometExt ERC20WithCallBack:comet=CometHarness \
<<<<<<< HEAD
    --solc solc8.13 \
    --staging jtoman/comet-recursion \
    $RULE \
=======
    --solc solc8.11 \
    --staging jtoman/comet-recursion \
    $RULE \
    --send_only \
>>>>>>> upstream/certora
    --optimistic_loop \
    --loop_iter 2 --rule_sanity \
    --settings -contractRecursionLimit=1,-enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometHarness:cometAbsorbBuyCollateral.spec Reentrancy sanity $RULE "
