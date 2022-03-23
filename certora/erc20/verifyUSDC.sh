certoraRun certora/erc20/USDC.sol:FiatTokenV2_1  \
    --verify FiatTokenV2_1:certora/erc20/erc20.spec  \
    --solc solc6.12 \
    --staging \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "ERC20:erc20.spec $1"