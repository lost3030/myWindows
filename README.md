# Desktop Widgets 桌面组件

精美的 Windows 桌面自定义悬浮组件，支持实时股票行情和毫秒级精度时钟。

## 功能特性

- **时钟组件** — 精确到毫秒的时间显示，支持 24 小时制 / 12 小时制
- **股票组件** — 实时行情展示，支持 A 股（沪/深）、港股、美股
- **玻璃拟态** — Glassmorphism 风格透明悬浮窗口
- **系统托盘** — 后台运行，托盘图标快捷操作
- **自定义设置** — 主题颜色、透明度、刷新频率等
- **位置记忆** — 拖拽定位自动保存
- **多实例支持** — 可创建多个同类型组件

## 技术栈

- **Electron** — 原生桌面体验（透明无边框窗口、系统托盘、置顶显示）
- **React 19 + TypeScript** — 组件化 UI
- **Vite** — 极速开发构建
- **East Money API** — 免费实时行情数据源

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式 (Vite + Electron 并行启动)
npm run dev

# 构建生产版本
npm run build

# 打包为 Windows 安装程序
npm run package
```

## 项目结构

```
├── main.js                  # Electron 主进程
├── preload.js               # 安全 IPC 桥接
├── index.html               # 入口 HTML
├── src/
│   ├── main.tsx             # React 入口
│   ├── App.tsx              # 应用路由
│   ├── types.ts             # TypeScript 类型定义
│   ├── components/
│   │   ├── ClockWidget.tsx  # 时钟组件
│   │   ├── StockWidget.tsx  # 股票组件
│   │   └── SettingsPanel.tsx # 设置面板
│   └── styles/
│       └── global.css       # 全局样式
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 股票代码格式

| 市场 | 前缀 | 示例 |
|------|------|------|
| 上海 A 股 | sh | 600519 (贵州茅台) |
| 深圳 A 股 | sz | 000858 (五粮液) |
| 港股 | hk | 00700 (腾讯控股) |
| 美股 | us | AAPL (Apple) |

## 自定义配置

配置文件自动保存在 `%APPDATA%/desktop-widgets/widget-config.json`，包含：

- 组件列表及位置
- 自选股列表
- 主题和外观设置

## 开源许可

本项目以 [MIT 许可证](LICENSE) 发布。使用、修改、再分发时请保留 `LICENSE` 中的版权声明与许可全文。

若你希望改为 **GPL-3.0**、**Apache-2.0** 等其它协议，可自行替换根目录的 `LICENSE` 文件，并同步修改 `package.json` 中的 `"license"` 字段。

## 推送到 Git 远程仓库

在本地首次初始化并推送示例：

```bash
git init
git add .
git commit -m "chore: initial commit"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

将 `<你的用户名>` / `<仓库名>` 换成你在 GitHub（或 Gitee 等）上创建的空仓库地址。若远程已存在提交，请先 `git pull --rebase origin main` 再推送。
