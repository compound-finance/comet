certoraRun certora/harness/CometHarnessWrappers.sol \
    --verify CometHarnessWrappers:certora/specs/UserCollateralAsset.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --rule check_update_UserCollater \
    --settings -useBitVectorTheory \
    --msg "$1"