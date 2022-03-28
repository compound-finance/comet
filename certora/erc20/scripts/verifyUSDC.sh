if [[ "$1" ]]
then
    RULE="--rule $1"
fi


certoraRun certora/erc20/tokens/USDC.sol:FiatTokenV2_1  \
    --verify FiatTokenV2_1:certora/erc20/erc20.spec $RULE  \
    --solc solc6.12 \
    --staging \
    --send_only \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "USDC:erc20.spec $1"