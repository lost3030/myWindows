export interface StockInfo {
  code: string;
  market: 'sh' | 'sz' | 'bj' | 'hk' | 'us' | 'futures';
  name: string;
  secid?: string;
}

export interface StockSearchResult {
  code: string;
  name: string;
  market: string;
  type: string;
  secid: string;
}

export interface StockData extends StockInfo {
  price: number;
  changePercent: number;
  changeAmount: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
}

export interface TrendPoint {
  prices: number[];
  times: string[];
  preClose: number;
}

export interface ClockConfig {
  showDate: boolean;
  showMilliseconds: boolean;
  showSeconds: boolean;
  format24h: boolean;
}

export interface StockConfig {
  stocks: StockInfo[];
  refreshInterval: number;
}

export interface WidgetDef {
  id: string;
  type: 'clock' | 'stock';
  x: number;
  y: number;
  width: number;
  height: number;
  config: ClockConfig | StockConfig;
}

export interface AppConfig {
  widgets: WidgetDef[];
  theme: {
    opacity: number;
    accentColor: string;
    background: string;
  };
}

interface ElectronAPI {
  getWidgetParams: () => Promise<WidgetDef | { type: 'settings' } | null>;
  getWidgetConfig: (id: string) => Promise<ClockConfig | StockConfig | null>;
  getAllConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  fetchStocks: (stocks: StockInfo[]) => Promise<StockData[]>;
  fetchStockTrends: (stocks: StockInfo[]) => Promise<Record<string, TrendPoint>>;
  searchStock: (keyword: string) => Promise<StockSearchResult[]>;
  openSettings: () => Promise<void>;
  closeWidget: () => Promise<void>;
  addWidget: (type: string, config: ClockConfig | StockConfig) => Promise<WidgetDef>;
  removeWidget: (id: string) => Promise<void>;
  updateWidgetConfig: (id: string, config: Partial<ClockConfig | StockConfig>) => Promise<void>;
  onConfigUpdated: (callback: (config: AppConfig) => void) => () => void;
  onWidgetConfigUpdated: (callback: (config: ClockConfig | StockConfig) => void) => () => void;
  windowMinimize: () => Promise<void>;
  windowClose: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
