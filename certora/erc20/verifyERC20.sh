certoraRun certora/harness/DummyERC20Impl.sol  \
    --verify DummyERC20Impl:certora/erc20/erc20.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "USDT:verifyUSDT.spec $1"