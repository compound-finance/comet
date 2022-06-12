<<<<<<< HEAD
patch -p1 ./contracts/Comet.sol ./certora/certora_modifications.patch
sh certora/scripts/verifyComet.sh assetIn_initialized_with_balance
sh certora/scripts/verifyComet.sh usage_registered_assets_only
sh certora/scripts/verifyAssetInfo.sh
sh certora/scripts/verifyCometWithdrawSupply.sh
sh certora/scripts/verifyPause.sh
sh certora/scripts/verifyUserAssetIn.sh
sh certora/scripts/verifyComet.sh balance_change_vs_accrue
sh certora/scripts/verifyComet.sh balance_change_vs_registered
sh certora/scripts/verifyComet.sh verify_transferAsset
sh certora/scripts/verifyCometTotalsAndBalances.sh total_collateral_per_asset
sh certora/scripts/verifyCometTotalsAndBalances.sh total_asset_collateral_vs_asset_balance
sh certora/scripts/verifyCometTotalsAndBalances.sh base_balance_vs_totals
sh certora/scripts/verifyCometTotalsAndBalances.sh collateral_totalSupply_LE_supplyCap
sh certora/scripts/verifyCometTotalsAndBalances.sh total_base_token
sh certora/scripts/verifyCometTotalsAndBalances.sh balance_change_by_allowed_only
sh certora/scripts/verifyCometAbsorbBuyCollateral.sh
sh certora/scripts/verifyCometExt.sh
sh certora/scripts/verifyGovernance.sh
sh certora/scripts/verifyInterestComputation.sh
sh certora/scripts/verifyPauseGuardians.sh
patch -p1 -R ./contracts/Comet.sol ./certora/certora_modifications.patch 
=======
patch -p1 ./contracts/Comet.sol ./certora/scripts/certora_modifications.patch
./certora/scripts/verifyAssetInfo.sh
./certora/scripts/verifyComet.sh
./certora/scripts/verifyCometAbsorbBuyCollateral.sh
./certora/scripts/verifyCometExt.sh
./certora/scripts/verifyCometTotalsAndBalances.sh
./certora/scripts/verifyCometWithdrawSupply.sh
./certora/scripts/verifyGovernance.sh
./certora/scripts/verifyInterestComputation.sh
./certora/scripts/verifyPause.sh
./certora/scripts/verifyPauseGuardians.sh
./certora/scripts/verifyUserAssetIn.sh
patch -p1 -R ./contracts/Comet.sol ./certora/scripts/certora_modifications.patch
>>>>>>> upstream/certora
