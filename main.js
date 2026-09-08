const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const isDev = !app.isPackaged;

if (!isDev) {
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
  });
}
const VITE_DEV_URL = 'http://localhost:5173';

// ─── Single Instance Lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

// ─── State ───────────────────────────────────────────────────────────────────
let config;
let tray = null;
let settingsWindow = null;
const widgetWindows = new Map();

// ─── 置顶维持 ────────────────────────────────────────────────────────────────
// Windows 上的"置顶"不是设一次就永久生效。别的程序会把窗口挤出置顶层,表现是
// WS_EX_TOPMOST 标志还留着、z 序却已经掉到普通窗口下面,于是 Chrome、Claude 桌面版
// 这类最大化窗口就把组件盖住了(2026-09-08 实测)。系统不提供"我被挤下去了"的事件,
// 所以只能定期重新申明。单次调用就是一个 SetWindowPos,开销可以忽略。
const KEEP_ON_TOP_INTERVAL_MS = 1000;
let keepOnTopTimer = null;

function reassertAlwaysOnTop() {
  for (const [, win] of widgetWindows) {
    if (win.isDestroyed() || !win.isVisible()) continue;
    win.setAlwaysOnTop(true, 'screen-saver');
  }
}

function startKeepOnTop() {
  if (keepOnTopTimer) clearInterval(keepOnTopTimer);
  keepOnTopTimer = setInterval(reassertAlwaysOnTop, KEEP_ON_TOP_INTERVAL_MS);
}

// ─── Default Configuration ───────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  widgets: [
    {
      id: 'clock-1',
      type: 'clock',
      x: 60,
      y: 60,
      width: 360,
      height: 170,
      config: {
        showDate: true,
        showMilliseconds: true,
        showSeconds: true,
        format24h: true,
      },
    },
    {
      id: 'stock-1',
      type: 'stock',
      x: 60,
      y: 260,
      width: 400,
      height: 460,
      config: {
        stocks: [
          { code: '600519', market: 'sh', name: '贵州茅台' },
          { code: '000858', market: 'sz', name: '五粮液' },
          { code: '00700', market: 'hk', name: '腾讯控股' },
          { code: 'AAPL', market: 'us', name: 'Apple' },
          { code: 'MSFT', market: 'us', name: 'Microsoft' },
        ],
        refreshInterval: 5000,
      },
    },
  ],
  theme: {
    opacity: 0.88,
    accentColor: '#6366f1',
    background: 'none',
  },
};

// ─── Config Persistence ──────────────────────────────────────────────────────
function getConfigPath() {
  return path.join(app.getPath('userData'), 'widget-config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const saved = JSON.parse(raw);
    const merged = { ...DEFAULT_CONFIG, ...saved };
    merged.theme = { ...DEFAULT_CONFIG.theme, ...(saved.theme || {}) };
    return merged;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// ─── Stock Data Service ──────────────────────────────────────────────────────
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://quote.eastmoney.com/',
};

function proxyFetch(url, options = {}) {
  return fetch(url, options);
}

function getSecId(market, code) {
  const map = { sh: '1', sz: '0', bj: '0', hk: '116', us: '105' };
  return `${map[market] || '1'}.${code}`;
}

function resolveSecId(stock) {
  return stock.secid || getSecId(stock.market, stock.code);
}

function detectMarketFromCode(code) {
  if (/^[A-Za-z]/.test(code)) return 'us';
  if (/^\d{5}$/.test(code)) return 'hk';
  if (/^(43|83|87|82|88)\d{4}$/.test(code) || /^920\d{3}$/.test(code)) return 'bj';
  if (/^(6|5)\d{5}$/.test(code)) return 'sh';
  if (/^(0|1|2|3)\d{5}$/.test(code)) return 'sz';
  return 'sh';
}

function detectMarketFromSearch(item) {
  const code = item.Code || '';
  const typeName = item.SecurityTypeName || '';
  const quoteId = item.QuoteID || '';

  if (typeName === '期货') return 'futures';
  if (typeName.includes('沪')) return 'sh';
  if (typeName.includes('京')) return 'bj';
  if (typeName.includes('深')) return 'sz';
  if (typeName.includes('港')) return 'hk';
  if (typeName.includes('美') || typeName.includes('英')) return 'us';

  const mktNum = String(item.MktNum || '');
  if (mktNum === '1') return 'sh';
  if (mktNum === '0') {
    if (/^(43|83|87|82|88)\d{4}$/.test(code) || /^920\d{3}$/.test(code) || /^899\d{3}$/.test(code)) {
      return 'bj';
    }
    return 'sz';
  }
  if (['116', '128'].includes(mktNum)) return 'hk';
  if (['105', '106', '107'].includes(mktNum)) return 'us';

  if (quoteId) return 'futures';
  return detectMarketFromCode(code);
}

async function searchFromEastMoney(keyword) {
  const url =
    'https://searchapi.eastmoney.com/api/suggest/get' +
    `?input=${encodeURIComponent(keyword)}&type=14` +
    '&token=D43BF722C8E33BDC906FB84D85E326E8&count=8';

  const res = await proxyFetch(url, { headers: FETCH_HEADERS });
  const json = await res.json();
  const data = json?.QuotationCodeTable?.Data;
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      const code = item.Code || '';
      const name = item.Name || code;
      const typeName = item.SecurityTypeName || '';
      const market = detectMarketFromSearch(item);
      const secid = item.QuoteID || '';

      return { code, name, market, type: typeName, secid };
    })
    .filter((item) => item.code);
}

async function lookupByCode(code) {
  const market = detectMarketFromCode(code);
  const secid = getSecId(market, code);
  const url =
    'https://push2.eastmoney.com/api/qt/ulist.np/get' +
    `?fltt=2&fields=f12,f14&secids=${secid}`;

  const res = await fetch(url, { headers: FETCH_HEADERS });
  const json = await res.json();
  if (json.data?.diff?.[0]) {
    const item = json.data.diff[0];
    if (item.f14 && item.f14 !== '-') {
      return { code: item.f12 || code, name: item.f14, market, type: '', secid };
    }
  }
  return null;
}

async function searchStock(keyword) {
  if (!keyword || keyword.trim().length === 0) return [];
  keyword = keyword.trim();

  try {
    const results = await searchFromEastMoney(keyword);
    if (results.length > 0) return results;
  } catch (err) {
    console.error('East Money search failed:', err.message);
  }

  if (/^\d{5,6}$/.test(keyword) || /^[A-Za-z]{1,6}$/.test(keyword)) {
    try {
      const direct = await lookupByCode(keyword);
      if (direct) return [direct];
    } catch (err) {
      console.error('Direct lookup failed:', err.message);
    }
  }

  return [];
}

// ─── Symbol Mapping ──────────────────────────────────────────────────────────

function getTencentSymbol(stock) {
  const prefixMap = { sh: 'sh', sz: 'sz', bj: 'bj', hk: 'hk', us: 'us' };
  const prefix = prefixMap[stock.market];
  if (!prefix) return null;
  return `${prefix}${stock.code}`;
}

// 这个 app 把"非沪深港美"的品种(境外指数 / 期货 / 债券收益率)统一记成
// market='futures',它们用的是东财自己的代码,所以换数据源时必须逐个映射。
// 下表每一条都在 2026-08-20 实测拿到过真实报价。
const YAHOO_FUTURES_MAP = {
  B00Y: 'BZ=F',   // 布伦特原油
  scm: 'CL=F',
  aum: 'GC=F',
  nim: 'NI=F',
  cum: 'HG=F',
  SPX: '^GSPC',   // 标普500
  US30Y: '^TYX',  // 美国30年期国债收益率
  US10Y: '^TNX',  // 美国10年期国债收益率
  NDX: '^NDX',    // 纳斯达克100
  DJIA: '^DJI',   // 道琼斯工业指数
  VIX: '^VIX',    // 恐慌指数
};

// 新浪外盘接口,用来兜住 Yahoo 查不到的品种(目前只有富时中国A50)。
const SINA_FUTURES_MAP = {
  XIN9: 'CHA50CFD', // 富时中国A50期货
};

function getYahooSymbol(stock) {
  if (stock.market === 'us') return stock.code;
  if (stock.market === 'hk') return stock.code.padStart(4, '0') + '.HK';
  if (stock.market === 'sh') return stock.code + '.SS';
  if (stock.market === 'sz') return stock.code + '.SZ';
  if (stock.market === 'bj') return stock.code + '.BJ';
  if (stock.market === 'futures') return YAHOO_FUTURES_MAP[stock.code] || null;
  return null;
}

function getSinaSymbol(stock) {
  if (stock.market !== 'futures') return null;
  return SINA_FUTURES_MAP[stock.code] || null;
}

// 腾讯和新浪的接口都是 GBK 编码。数字部分是纯 ASCII,所以万一运行环境缺
// GBK 解码能力,退回 latin1 也只是名字乱码,报价照常能解析出来。
function decodeGbk(buf) {
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    return buf.toString('latin1');
  }
}

function makeQuote(stock, fields, source) {
  return {
    code: stock.code,
    name: stock.name || fields.name || stock.code,
    price: Number(fields.price),
    changePercent: Number(fields.changePercent) || 0,
    changeAmount: Number(fields.changeAmount) || 0,
    high: Number(fields.high) || 0,
    low: Number(fields.low) || 0,
    open: Number(fields.open) || 0,
    prevClose: Number(fields.prevClose) || 0,
    market: stock.market,
    secid: stock.secid || '',
    source,
  };
}

// ─── Quote Source 1:东方财富(一次批量拿完所有品种)───────────────────────────
async function fetchQuotesFromEastMoney(stocks) {
  const byCode = new Map();
  const secids = stocks.map((s) => resolveSecId(s)).join(',');
  const url =
    'https://push2.eastmoney.com/api/qt/ulist.np/get' +
    `?fltt=2&fields=f2,f3,f4,f12,f14,f15,f16,f17,f18&secids=${secids}`;

  const res = await proxyFetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(6000) });
  const json = await res.json();
  const diff = json.data && json.data.diff;
  if (!Array.isArray(diff)) return byCode;

  // 按代码建索引,而不是按返回顺序对位:东财遇到无效 secid 会直接少返一条,
  // 按下标对位会让后面所有品种的数据整体错位。
  for (const item of diff) {
    const price = Number(item.f2);
    if (item.f12 == null || !isFinite(price) || price === 0) continue;
    byCode.set(String(item.f12).toUpperCase(), item);
  }
  return byCode;
}

// ─── Quote Source 2:Yahoo Finance ───────────────────────────────────────────
async function fetchQuoteFromYahoo(stock) {
  const symbol = getYahooSymbol(stock);
  if (!symbol) return null;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const res = await proxyFetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json();
  const meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;
  const price = meta && Number(meta.regularMarketPrice);
  if (!meta || !isFinite(price) || price === 0) return null;

  const prevRaw = meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose;
  const prevClose = Number(prevRaw) || 0;
  const changeAmount = prevClose ? price - prevClose : 0;

  return makeQuote(stock, {
    name: meta.shortName,
    price,
    changePercent: prevClose ? (changeAmount / prevClose) * 100 : 0,
    changeAmount,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    open: 0,
    prevClose,
  }, 'Yahoo');
}

// ─── Quote Source 3:腾讯 ────────────────────────────────────────────────────
async function fetchQuoteFromTencent(stock) {
  const symbol = getTencentSymbol(stock);
  if (!symbol) return null;

  const res = await proxyFetch(`https://qt.gtimg.cn/q=${symbol}`, { signal: AbortSignal.timeout(6000) });
  const text = decodeGbk(Buffer.from(await res.arrayBuffer()));
  const matched = text.match(/="([^"]*)"/);
  if (!matched) return null;

  // 字段序:1 名称 / 3 现价 / 4 昨收 / 5 今开 / 31 涨跌额 / 32 涨跌幅 / 33 最高 / 34 最低
  const f = matched[1].split('~');
  const price = parseFloat(f[3]);
  if (!isFinite(price) || price === 0) return null;

  return makeQuote(stock, {
    name: f[1],
    price,
    changePercent: parseFloat(f[32]),
    changeAmount: parseFloat(f[31]),
    high: parseFloat(f[33]),
    low: parseFloat(f[34]),
    open: parseFloat(f[5]),
    prevClose: parseFloat(f[4]),
  }, '腾讯');
}

// ─── Quote Source 4:新浪外盘 ────────────────────────────────────────────────
async function fetchQuoteFromSina(stock) {
  const symbol = getSinaSymbol(stock);
  if (!symbol) return null;

  const res = await proxyFetch(`https://hq.sinajs.cn/list=hf_${symbol}`, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    signal: AbortSignal.timeout(6000),
  });
  const text = decodeGbk(Buffer.from(await res.arrayBuffer()));
  const matched = text.match(/="([^"]*)"/);
  if (!matched || !matched[1]) return null;

  // 字段序:0 现价 / 2 买 / 3 卖 / 4 最高 / 5 最低 / 6 时间 / 7 昨结 / 8 开盘 / 13 名称
  const f = matched[1].split(',');
  const price = parseFloat(f[0]);
  if (!isFinite(price) || price === 0) return null;

  const prevClose = parseFloat(f[7]) || 0;
  const changeAmount = prevClose ? price - prevClose : 0;

  return makeQuote(stock, {
    name: f[13],
    price,
    changePercent: prevClose ? (changeAmount / prevClose) * 100 : 0,
    changeAmount,
    high: parseFloat(f[4]),
    low: parseFloat(f[5]),
    open: parseFloat(f[8]),
    prevClose,
  }, '新浪');
}

// ─── Quote 编排:东财 → Yahoo → 腾讯 → 新浪 ──────────────────────────────────
// 先用东财批量拿一次,没拿到的品种再逐个走后面三个源,任一成功即采用,
// 单个品种取不到不影响其它品种。2026-08-20 东财两台行情机整体不可达时,
// 就是靠这条链把标普500 / 美30Y国债 / 布伦特 / A50 的报价兜住的。
async function fetchStockData(stocks) {
  if (!stocks || stocks.length === 0) return [];

  const results = new Array(stocks.length).fill(null);

  let emByCode = new Map();
  try {
    emByCode = await fetchQuotesFromEastMoney(stocks);
  } catch (err) {
    console.error('[quote] 东财整体失败:', err.message);
  }

  stocks.forEach((stock, idx) => {
    const item = emByCode.get(String(stock.code).toUpperCase());
    if (!item) return;
    results[idx] = makeQuote(stock, {
      name: item.f14,
      price: item.f2,
      changePercent: item.f3,
      changeAmount: item.f4,
      high: item.f15,
      low: item.f16,
      open: item.f17,
      prevClose: item.f18,
    }, '东财');
  });

  const pending = [];
  stocks.forEach((stock, idx) => {
    if (!results[idx]) pending.push({ stock, idx });
  });

  await Promise.all(
    pending.map(async ({ stock, idx }) => {
      for (const fetchFn of [fetchQuoteFromYahoo, fetchQuoteFromTencent, fetchQuoteFromSina]) {
        try {
          const quote = await fetchFn(stock);
          if (quote) {
            results[idx] = quote;
            return;
          }
        } catch {}
      }
      console.error(`[quote] 所有数据源都失败:${stock.market}-${stock.code}`);
    }),
  );

  return results.filter(Boolean);
}

async function fetchTrendFromTencent(stock) {
  const symbol = getTencentSymbol(stock);
  if (!symbol) return null;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`;
  const res = await proxyFetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  const jsonStr = text.replace(/^[^{]*/, '');
  const json = JSON.parse(jsonStr);
  const d = json.data?.[symbol];
  if (!d?.data?.data?.length) return null;
  const prices = [];
  const times = [];
  for (const entry of d.data.data) {
    const parts = entry.split(' ');
    if (parts.length >= 2) {
      const t = parts[0];
      const price = parseFloat(parts[1]);
      if (!isNaN(price) && t.length >= 4) {
        times.push(t.slice(0, 2) + ':' + t.slice(2, 4));
        prices.push(price);
      }
    }
  }
  if (prices.length < 2) return null;
  const preClose = parseFloat(d.qt?.[symbol]?.[4]) || 0;
  return { prices, times, preClose };
}

async function fetchTrendFromYahoo(stock) {
  const symbol = getYahooSymbol(stock);
  if (!symbol) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const res = await proxyFetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result?.timestamp?.length) return null;
  const closePrices = result.indicators?.quote?.[0]?.close;
  const preClose = result.meta?.chartPreviousClose || 0;
  const prices = [];
  const times = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const price = closePrices?.[i];
    if (price == null || isNaN(price)) continue;
    const d = new Date(result.timestamp[i] * 1000);
    times.push(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
    prices.push(price);
  }
  if (prices.length < 2) return null;
  return { prices, times, preClose };
}

async function fetchTrendFromSina(stock) {
  const symbol = getSinaSymbol(stock);
  if (!symbol) return null;

  const url =
    'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/x/GlobalFuturesService.getGlobalFuturesMinLine' +
    `?symbol=${symbol}`;
  const res = await proxyFetch(url, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();

  const start = text.indexOf('x(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) return null;

  let rows;
  try {
    rows = JSON.parse(text.slice(start + 2, end)).minLine_1d;
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length < 2) return null;

  // 首行比后续行多带 日期 / 昨结 / 交易所 三个前缀字段,所以一律从尾部数:
  // [-6]=时间 [-5]=价格 [-4]=成交量 [-3]=持仓 [-2]=均价 [-1]=完整时间。
  const prices = [];
  const times = [];
  let preClose = 0;

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    if (row.length >= 10 && !preClose) preClose = parseFloat(row[1]) || 0;
    const time = row[row.length - 6];
    const price = parseFloat(row[row.length - 5]);
    if (typeof time !== 'string' || !isFinite(price)) continue;
    times.push(time);
    prices.push(price);
  }
  if (prices.length < 2) return null;

  return { prices, times, preClose };
}

async function fetchTrendFromEastMoney(stock) {
  const secid = resolveSecId(stock);
  const url =
    'https://push2his.eastmoney.com/api/qt/stock/trends2/get' +
    `?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f53&iscr=0&ndays=1`;
  const res = await proxyFetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(6000) });
  const json = await res.json();
  if (!json.data?.trends) return null;
  const prices = [];
  const times = [];
  for (const t of json.data.trends) {
    const parts = t.split(',');
    const price = parseFloat(parts[1]);
    if (!isNaN(price)) {
      times.push(parts[0]);
      prices.push(price);
    }
  }
  if (prices.length < 2) return null;
  return { prices, times, preClose: json.data.preClose || 0 };
}

const TREND_DISPLAY_MAX = 144;

function downsampleTrend(prices, times, maxPts = TREND_DISPLAY_MAX) {
  if (!prices?.length || prices.length <= maxPts) return { prices, times };
  const n = prices.length;
  const step = (n - 1) / (maxPts - 1);
  const np = [];
  const nt = [];
  for (let i = 0; i < maxPts; i++) {
    const idx = Math.min(n - 1, Math.round(i * step));
    np.push(prices[idx]);
    nt.push(times[idx]);
  }
  return { prices: np, times: nt };
}

async function fetchStockTrends(stocks) {
  if (!stocks || stocks.length === 0) return {};

  const results = {};
  const promises = stocks.map(async (s) => {
    const key = `${s.market}-${s.code}`;
    const isAshare = ['sh', 'sz', 'bj'].includes(s.market);
    const sources = isAshare
      ? [fetchTrendFromTencent, fetchTrendFromYahoo, fetchTrendFromEastMoney]
      : [fetchTrendFromYahoo, fetchTrendFromTencent, fetchTrendFromEastMoney, fetchTrendFromSina];

    for (const fn of sources) {
      try {
        const data = await fn(s);
        if (data) {
          const ds = downsampleTrend(data.prices, data.times);
          results[key] = { prices: ds.prices, times: ds.times, preClose: data.preClose };
          return;
        }
      } catch {}
    }
  });

  await Promise.all(promises);
  return results;
}

// ─── Tray Icon (Programmatic PNG) ────────────────────────────────────────────
function createTrayIcon() {
  const size = 16;
  const raw = Buffer.alloc((size * 4 + 1) * size);

  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const px = row + 1 + x * 4;
      const cx = (x - size / 2 + 0.5) / (size / 2);
      const cy = (y - size / 2 + 0.5) / (size / 2);
      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist < 0.9) {
        const t = 1 - dist * 0.5;
        raw[px] = Math.round(99 * t + 120 * (1 - t));
        raw[px + 1] = Math.round(102 * t + 80 * (1 - t));
        raw[px + 2] = Math.round(241 * t + 200 * (1 - t));
        raw[px + 3] = dist < 0.75 ? 255 : Math.round(255 * (1 - (dist - 0.75) / 0.15));
      }
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) | 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const tp = Buffer.from(type);
    const body = Buffer.concat([tp, data]);
    const crc = Buffer.alloc(4);
    crc.writeInt32BE(crc32(body));
    return Buffer.concat([len, tp, data, crc]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  return nativeImage.createFromBuffer(png);
}

// ─── Window Management ───────────────────────────────────────────────────────
function getWidgetURL(type, id) {
  const params = new URLSearchParams({ widget: type, id: id || '' });
  if (isDev) return `${VITE_DEV_URL}?${params}`;
  return null;
}

function createWidgetWindow(widget) {
  const win = new BrowserWindow({
    width: widget.width,
    height: widget.height,
    x: widget.x,
    y: widget.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  if (isDev) {
    const url = getWidgetURL(widget.type, widget.id);
    win.loadURL(url);
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'), {
      query: { widget: widget.type, id: widget.id },
    });
  }

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    const w = config.widgets.find((w) => w.id === widget.id);
    if (w) {
      w.x = x;
      w.y = y;
      saveConfig(config);
    }
  });

  win.on('closed', () => {
    widgetWindows.delete(widget.id);
  });

  widgetWindows.set(widget.id, win);
  return win;
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 680,
    height: 780,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  if (isDev) {
    const params = new URLSearchParams({ widget: 'settings' });
    settingsWindow.loadURL(`${VITE_DEV_URL}?${params}`);
  } else {
    settingsWindow.loadFile(path.join(__dirname, 'dist', 'index.html'), {
      query: { widget: 'settings' },
    });
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('get-widget-config', (_event, widgetId) => {
    const widget = config.widgets.find((w) => w.id === widgetId);
    return widget ? widget.config : null;
  });

  ipcMain.handle('get-all-config', () => config);

  ipcMain.handle('save-config', (_event, newConfig) => {
    config = newConfig;
    saveConfig(config);
    for (const [id, win] of widgetWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('config-updated', config);
        const widgetDef = config.widgets.find((w) => w.id === id);
        if (widgetDef) {
          win.webContents.send('widget-config-updated', widgetDef.config);
        }
      }
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('config-updated', config);
    }
  });

  ipcMain.handle('fetch-stocks', async (_event, stocks) => {
    return await fetchStockData(stocks);
  });

  ipcMain.handle('search-stock', async (_event, keyword) => {
    return await searchStock(keyword);
  });

  ipcMain.handle('fetch-stock-trends', async (_event, stocks) => {
    return await fetchStockTrends(stocks);
  });

  ipcMain.handle('get-widget-params', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    for (const [id, w] of widgetWindows) {
      if (w === win) {
        return config.widgets.find((wg) => wg.id === id) || null;
      }
    }
    if (win === settingsWindow) return { type: 'settings' };
    return null;
  });

  ipcMain.on('open-settings', () => createSettingsWindow());

  ipcMain.on('close-widget', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle('add-widget', (_event, type, widgetConfig) => {
    const id = `${type}-${Date.now()}`;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const widget = {
      id,
      type,
      x: Math.round(sw / 2 - 175),
      y: Math.round(sh / 2 - 100),
      width: type === 'clock' ? 360 : 400,
      height: type === 'clock' ? 170 : 460,
      config: widgetConfig,
    };
    config.widgets.push(widget);
    saveConfig(config);
    createWidgetWindow(widget);
    return widget;
  });

  ipcMain.handle('remove-widget', (_event, widgetId) => {
    const win = widgetWindows.get(widgetId);
    if (win && !win.isDestroyed()) win.close();
    config.widgets = config.widgets.filter((w) => w.id !== widgetId);
    saveConfig(config);
  });

  ipcMain.handle('update-widget-config', (_event, widgetId, newWidgetConfig) => {
    const widget = config.widgets.find((w) => w.id === widgetId);
    if (widget) {
      widget.config = { ...widget.config, ...newWidgetConfig };
      saveConfig(config);
      const win = widgetWindows.get(widgetId);
      if (win && !win.isDestroyed()) {
        win.webContents.send('widget-config-updated', widget.config);
      }
    }
  });

  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────
app.on('second-instance', () => {
  if (settingsWindow) settingsWindow.focus();
  else createSettingsWindow();
});

app.whenReady().then(() => {
  config = loadConfig();
  setupIPC();

  const icon = createTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '设置', click: () => createSettingsWindow() },
    { type: 'separator' },
    {
      label: '显示所有组件',
      click: () => {
        for (const [, win] of widgetWindows) {
          if (!win.isDestroyed()) {
            win.show();
            win.setAlwaysOnTop(true);
          }
        }
      },
    },
    {
      label: '隐藏所有组件',
      click: () => {
        for (const [, win] of widgetWindows) {
          if (!win.isDestroyed()) win.hide();
        }
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);

  tray.setToolTip('Desktop Widgets - 桌面组件');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => createSettingsWindow());

  for (const widget of config.widgets) {
    createWidgetWindow(widget);
  }

  startKeepOnTop();

  // 这三类事件都会重排 z 序,除了定时兜底之外再各补一次,让恢复不用等下一个周期。
  screen.on('display-added', reassertAlwaysOnTop);
  screen.on('display-removed', reassertAlwaysOnTop);
  screen.on('display-metrics-changed', reassertAlwaysOnTop);
  powerMonitor.on('resume', reassertAlwaysOnTop);
});

app.on('window-all-closed', () => {
  // Keep running in tray
});
