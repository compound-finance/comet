# CometConfiguration

## ExtConfiguration

- bytes32 name32;
  - ベーストークンをラップするときのトークン名
- bytes32 symbol32;
  - ベーストークンをラップするときのシンボル名

## Configuration

https://docs.compound.finance/helper-functions/#get-protocol-configuration

- address governor;
  - プールのガバナー
- address pauseGuardian;
  - プールの停止専用権限
- address baseToken;
  - ベーストークン
- address baseTokenPriceFeed;
  - ベーストークンの価格フィード
- address extensionDelegate;
  - CometExt のアドレス
- uint64 supplyKink;
  - 貸出の低金利スロープと高金利スロープの閾値となる利用率の閾値
  - 範囲：0〜1E+18（利用率は 100%が上限として）
  - 1e18 でスケールされる
- uint64 supplyPerYearInterestRateSlopeLow;
  - 低金利スロープの年利率(y=ax+b の a)
  - 範囲：0〜2^64（約 1.8E+19）
  - 1e18 でスケールされる
- uint64 supplyPerYearInterestRateSlopeHigh;
  - 高金利スロープの年利率(y=ax+b の a)
  - 範囲：0〜2^64（約 1.8E+19）
  - 1e18 でスケールされる
- uint64 supplyPerYearInterestRateBase;
  - 低金利スロープと高金利スロープの基礎値(y=ax+b の b)
  - 範囲：0〜2^64（約 1.8E+19）
  - 1e18 でスケールされる
- uint64 borrowKink;
  - 借入の低金利スロープと高金利スロープの閾値となる利用率の閾値
  - 範囲：0〜1E+18（利用率は 100%が上限として）
- uint64 borrowPerYearInterestRateSlopeLow;
  - 低金利スロープの年利率(y=ax+b の a)
  - 範囲：0〜2^64（約 1.8E+19）
  - 1e18 でスケールされる
- uint64 borrowPerYearInterestRateSlopeHigh;
  - 低金利スロープの年利率(y=ax+b の a)
  - 範囲：0〜2^64（約 1.8E+19）
  - 1e18 でスケールされる
- uint64 borrowPerYearInterestRateBase;
  - 低金利スロープと高金利スロープの基礎値(y=ax+b の b)
  - 範囲：0〜2^64（約 1.8E+19）
  - 1e18 でスケールされる
- uint64 storeFrontPriceFactor;
  - 清算ペナルティのうち、プロトコルの代わりに清算者に支払われる割合
  - 範囲：storeFrontPriceFactor ＜ FACTOR_SCALE(1E+18)
  - 1e18 でスケールされる
- uint64 trackingIndexScale;
  - 報酬計算用のスケーラー
  - 範囲：0〜2^64（約 1.8E+19）
- uint64 baseTrackingSupplySpeed;
  - 貸出向け報酬配布速度
  - 範囲：0〜2^64（約 1.8E+19）
  - 1 日に配布したい量\*86400/trackingIndexScale
- uint64 baseTrackingBorrowSpeed;
  - 借入向け報酬配布速度
  - 範囲：0〜2^64（約 1.8E+19）
  - 1 日に配布したい量\*86400/trackingIndexScale
- uint104 baseMinForRewards;
  - 貸出されるベーストークンの報酬が発生する最小量
  - 範囲：0〜2^104（ゼロは含まない）
- uint104 baseBorrowMin;
  - 借入の最小量
  - 範囲：0〜2^104（約 2E+31）
- uint104 targetReserves;
  - 担保を売却できるリザーブの閾値
  - 範囲：0〜2^104（約 2E+31）
- AssetConfig[] assetConfigs;
  - 担保トークンの設定（後述）

## AssetConfig

https://docs.compound.finance/helper-functions/#get-asset-info

- address asset;
  - アセット
- address priceFeed;
  - アセットの価格フィード
- uint8 decimals;
  - アセットのデシマル
- uint64 borrowCollateralFactor;
  - 借入可能な担保価値の割合
  - 1e18 でスケールされる
- uint64 liquidateCollateralFactor;
  - 清算可能になるまで借入可能な担保価値の割合
  - 1e18 でスケールされる
- uint64 liquidationFactor;
  - 清算のペナルティ
  - 1e18 でスケールされる
- uint128 supplyCap;
  - 担保資産の供給上限
