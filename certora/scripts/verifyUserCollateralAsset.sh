certoraRun certora/harness/CometHarnessWrappers.sol \
    --verify CometHarnessWrappers:certora/specs/UserCollateralAsset.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --rule update_changes_single_bit \
    --settings -useBitVectorTheory \
    --msg "$1"