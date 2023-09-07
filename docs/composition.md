
## DFGCにおけるコントラクト構成
```mermaid
graph TD;

    Bulker-->CometProxy;
    Safe==admin==>CometProxy;
    Safe==admin==>CometFactory;

    CometProxy==impl===>CometImpl;
    CometFactory==makes==>CometImpl;


```