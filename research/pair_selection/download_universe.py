import os
import sys
import time
from datetime import datetime, timezone
import pandas as pd
import ccxt

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

TIMEFRAME = "4h"
MONTHS = 18
TOP_N_TRADABLE = 60

EXCLUDE_BASES = {
    'USDC', 'FDUSD', 'TUSD', 'USDE', 'DAI', 'BUSD', 'EUR', 'USTC', 'USD1', 'AEUR', 'USDD', 'USD',
    'PAXG', 'XAUT', 'XAG', 'XAU', 'DEFI', 'BTCDOM', 'FOOTBALL', 'INDEX'
}

def get_exchange():
    return ccxt.binanceusdm({
        'enableRateLimit': True,
        'options': {
            'defaultType': 'future',
        }
    })

def select_universe(exchange):
    print("Loading markets and 24h tickers from Binance USDT-M Futures...")
    markets = exchange.load_markets()
    tickers = exchange.fetch_tickers()
    
    candidates = []
    for sym, t in tickers.items():
        m = markets.get(sym)
        if not m or not m.get('active') or not m.get('swap') or not m.get('linear') or m.get('quote') != 'USDT':
            continue
        info = m.get('info', {})
        underlying_type = info.get('underlyingType')
        if underlying_type and underlying_type != 'COIN':
            continue
        base = m['base']
        if base in EXCLUDE_BASES:
            continue
        contract_type = info.get('contractType')
        if contract_type and contract_type != 'PERPETUAL':
            continue
            
        quote_vol = float(t.get('quoteVolume') or 0.0)
        is_benchmark = base in {'BTC', 'ETH'}
        
        candidates.append({
            'symbol': sym,
            'base': base,
            'quoteVolume': quote_vol,
            'lastPrice': float(t.get('last') or 0.0),
            'is_benchmark': is_benchmark,
            'subType': str(info.get('underlyingSubType', ''))
        })
        
    df_all = pd.DataFrame(candidates).sort_values(by='quoteVolume', ascending=False).reset_index(drop=True)
    
    # Select top N tradable (excluding BTC & ETH)
    df_tradable = df_all[~df_all['is_benchmark']].head(TOP_N_TRADABLE).copy()
    
    # Benchmarks
    df_bench = df_all[df_all['is_benchmark']].copy()
    
    combined = pd.concat([df_bench, df_tradable], ignore_index=True)
    
    # Save snapshot
    snap_out = os.path.join(OUT_DIR, "universe_volume_snapshot.csv")
    combined.to_csv(snap_out, index=False)
    snap_data = os.path.join(DATA_DIR, "universe_volume_snapshot.csv")
    combined.to_csv(snap_data, index=False)
    print(f"Saved volume snapshot with {len(combined)} coins ({len(df_tradable)} tradable + {len(df_bench)} benchmarks) to {snap_out}")
    
    return combined, df_tradable['base'].tolist(), markets

def download_coin_ohlcv(exchange, coin, symbol, markets, start_since_ms, now_ms):
    out_path = os.path.join(DATA_DIR, f"4h_{coin}.csv")
    
    # Check if existing file is fresh
    if os.path.exists(out_path):
        try:
            existing_df = pd.read_csv(out_path)
            if len(existing_df) > 100:
                min_ts = existing_df['timestamp'].min()
                max_ts = existing_df['timestamp'].max()
                # Fresh if min_ts <= start_since_ms (or coin listing date) and max_ts >= now_ms - 8*3600*1000
                if max_ts >= now_ms - 8 * 3600 * 1000 and (min_ts <= start_since_ms + 24 * 3600 * 1000 or len(existing_df) >= 3200):
                    print(f"Skipping {coin}: fresh data already exists ({len(existing_df)} bars, {pd.to_datetime(min_ts, unit='ms', utc=True)} to {pd.to_datetime(max_ts, unit='ms', utc=True)})")
                    return
        except Exception as e:
            print(f"Could not read existing file {out_path}: {e}, redownloading...")

    if symbol not in markets:
        symbol_alt = f"{coin}/USDT:USDT"
        if symbol_alt in markets:
            symbol = symbol_alt
        else:
            print(f"Error: Symbol {symbol} not found in markets.")
            return

    print(f"Fetching {coin} ({symbol})...")
    all_ohlcv = []
    current_since = start_since_ms
    retries = 0
    
    while True:
        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe=TIMEFRAME, since=current_since, limit=1500)
            if not ohlcv:
                break
            
            # Deduplicate and append
            if all_ohlcv and ohlcv[0][0] == all_ohlcv[-1][0]:
                ohlcv = ohlcv[1:]
            
            if not ohlcv:
                break
            
            all_ohlcv.extend(ohlcv)
            last_ts = ohlcv[-1][0]
            
            if last_ts >= now_ms - 4 * 3600 * 1000 or len(ohlcv) < 1500:
                next_since = last_ts + 4 * 3600 * 1000
                if next_since > now_ms:
                    break
                current_since = next_since
            else:
                current_since = last_ts + 4 * 3600 * 1000
            
            retries = 0
            time.sleep(exchange.rateLimit / 1000.0)
        except Exception as e:
            retries += 1
            print(f"Warning: Exception fetching {symbol}: {e}. Retry {retries}/5...")
            if retries >= 5:
                print(f"Failed to fetch remaining data for {symbol}.")
                break
            time.sleep(2 * retries)
            
    if not all_ohlcv:
        print(f"No data returned for {coin}.")
        return
        
    df = pd.DataFrame(all_ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df.drop_duplicates(subset=["timestamp"], keep="last", inplace=True)
    df.sort_values(by="timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)
    
    first_dt = datetime.fromtimestamp(df["timestamp"].iloc[0] / 1000, tz=timezone.utc).isoformat()
    last_dt = datetime.fromtimestamp(df["timestamp"].iloc[-1] / 1000, tz=timezone.utc).isoformat()
    
    df.to_csv(out_path, index=False)
    print(f"Saved {coin}: {len(df)} bars ({first_dt} -> {last_dt}) -> {out_path}")

def main():
    exchange = get_exchange()
    universe_df, tradable_coins, markets = select_universe(exchange)
    
    now_ms = int(time.time() * 1000)
    eighteen_months_ms = int(MONTHS * 30.4375 * 24 * 3600 * 1000)
    start_since_ms = now_ms - eighteen_months_ms
    
    print(f"\nTarget start time: {datetime.fromtimestamp(start_since_ms / 1000, tz=timezone.utc).isoformat()}")
    print(f"Current time:      {datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc).isoformat()}")
    print(f"Downloading OHLCV for {len(universe_df)} coins...\n")
    
    for idx, row in universe_df.iterrows():
        coin = row['base']
        symbol = row['symbol']
        download_coin_ohlcv(exchange, coin, symbol, markets, start_since_ms, now_ms)
        time.sleep(0.05)
        
    print("\nDownload complete!")

if __name__ == "__main__":
    main()
