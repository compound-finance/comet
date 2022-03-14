
certoraRun contracts/CometExt.sol  \
    --verify CometExt:certora/specs/cometExt.spec  \
    --solc solc8.11 \
    --staging nast/update_report \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "CometExt:cometExt.spec $1"
