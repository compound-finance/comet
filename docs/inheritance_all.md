# 依存関係（継承）のまとめ
## 1.cometの主なコントラクト(その1)
```mermaid
graph TD;
    1(CometExt)
    2(CometFactory)
    3(CometProxy)
    4(Configurator)
    5{Comet}

    1-->CometExtInterface;
    CometExtInterface--->CometCore;

    5-->CometMainInterface;
    CometCore-->CometConfiguration;
    CometCore-->CometStorage;
    CometCore-->CometMath;

    2--->CometConfiguration;
    CometInterface---->CometMainInterface;
    CometInterface--->CometExtInterface;
    CometMainInterface--->CometCore;
    4-->ConfiguratorStorage;
    ConfiguratorStorage-->CometConfiguration;
```
## 1.cometの主なコントラクト(その2)
```mermaid
graph TD;
    1(CometProxyAdmin)
    2(ConfiguratorProxy)

    1-->ProxyAdmin;
    2-->TransparentUpgradeableProxy;
```
## 2.精算・リワードに関するコントラクト
```mermaid
graph TD;
0(CometRewards)

1(OnChainLiquidator)
1--->IUniswapV3FlashCallback;
1--->PeripheryImmutableState;
1--->PeripheryPayments;
```

## 3.プライスフィードに関するコントラクト
```mermaid
graph TD;
    MultiplicativePriceFeed--->IPriceFeed;
    WBTCPriceFeed--->IPriceFeed;
    subgraph テスト時に必要なもの
    ConstantPriceFeed
    end
    subgraph 実装するトークン次第で必要なもの
    MultiplicativePriceFeed
    WstETHPriceFeed
    WBTCPriceFeed
    end
    ScalingPriceFeed--->IPriceFeed;
    ConstantPriceFeed--->IPriceFeed;
    WstETHPriceFeed--->IPriceFeed;
```


## 4.トークンに関するコントラクト
```mermaid
graph TD;
    subgraph 実装するトークン次第で必要なもの
    IWETH9
    IWstETH
    IComp
    IERC20NonStandard
    end
    ERC20
    IWstETH-->ERC20;
    IComp-->ERC20;
    IERC20NonStandard;

```
## 5.補助的なコントラクト
```mermaid
graph TD;
    1(MainnetBulker)

    BaseBulker
    1--->BaseBulker;
    subgraph 不要と考えられるもの
    IProxy
    BaseBridgeReceiver
    SweepableBridgeReceiver-->BaseBridgeReceiver;
    end
```
## 6.ガバナンスに関するコントラクト
```mermaid
graph TD;
    subgraph 不要と考えられるもの
    IGovernorBravo;
    ITimelock;
    end
```

```
【図について】
継承関係を図にした。
派生コントラクト➜基底コントラクトを示している。
(派生コントラクト is 基底コントラクト)
-凡例-
丸四角：デプロイヤー（EOA）がデプロイするもの(確認出来た範囲で丸四角とした)
ひし型：コントラクトからデプロイされるもの
四角形：上記以外のもの
```