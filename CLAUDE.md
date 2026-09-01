# CLAUDE.md — myWindows

桌面组件 app,产品名 Desktop Widgets,仓库名不含 widget,历史上因此难找。

> **基线指针 2026-08-30**: 通用研发、文档、钩子规范的权威在 `G:\project\atlas\specs\`,本文件只写本项目增量,冲突时更严者胜。
> 写画图、行情、推送、检索、取数、调度代码之前先查 `G:\project\atlas\CAPABILITIES.md`,已有能力直接用,禁止再造平行实现。

## sharp edges

- 加自选股只改 AppData 下的 widget-config.json 并重启,不用重打包。
- 行情是四源回退链,东财 push2 域本机不通属已知现状。分时图旧版超 715 点会崩,1.1.0 起分段自适应。
- fetchStockData 曾静默吞网络异常导致价格冻结 16.5 小时,改动网络层必须保留停滞警告逻辑。
