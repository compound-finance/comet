if [[ "$1" ]]
then
    RULE="--rule $1"
fi


certoraRun certora/erc20/tokens/USDT.sol:TetherToken  \
    --verify TetherToken:certora/erc20/erc20.spec $RULE  \
    --solc solc4.24 \
    --staging \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "ERC20:erc20.spec $1"