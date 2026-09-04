import os
import time
from datetime import datetime, timezone
import pandas as pd
import ccxt

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
os.makedirs(DATA_DIR, exist_ok=True)

COINS = ["ZEC", "AVAX", "ENA", "SUI", "SOL", "ADA", "BNB", "ETH", "BTC"]
TIMEFRAME = "4h"
MONTHS = 18

def download_ohlcv():
    exchange = ccxt.binanceusdm({
        'enableRateLimit': True,
        'options': {
            'defaultType': 'future',
        }
    })
    
    # Load markets to resolve symbols properly
    markets = exchange.load_markets()
    
    # 18 months in ms
    now_ms = int(time.time() * 1000)
    eighteen_months_ms = int(MONTHS * 30.4375 * 24 * 3600 * 1000)
    start_since_ms = now_ms - eighteen_months_ms
    
    print(f"Target start time: {datetime.fromtimestamp(start_since_ms / 1000, tz=timezone.utc).isoformat()}")
    print(f"Current time:      {datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc).isoformat()}")
    
    for coin in COINS:
        symbol = f"{coin}/USDT"
        if symbol not in markets:
            symbol_alt = f"{coin}/USDT:USDT"
            if symbol_alt in markets:
                symbol = symbol_alt
            else:
                print(f"Error: Symbol {symbol} not found in markets.")
                continue
        
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
                
                # Check if we have reached near now (within 4 hours)
                if last_ts >= now_ms - 4 * 3600 * 1000 or len(ohlcv) < 1500:
                    # Let's check if the next since gives new data
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
            continue
            
        df = pd.DataFrame(all_ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df.drop_duplicates(subset=["timestamp"], keep="last", inplace=True)
        df.sort_values(by="timestamp", inplace=True)
        df.reset_index(drop=True, inplace=True)
        
        first_dt = datetime.fromtimestamp(df["timestamp"].iloc[0] / 1000, tz=timezone.utc).isoformat()
        last_dt = datetime.fromtimestamp(df["timestamp"].iloc[-1] / 1000, tz=timezone.utc).isoformat()
        
        out_path = os.path.join(DATA_DIR, f"4h_{coin}.csv")
        df.to_csv(out_path, index=False)
        print(f"Saved {coin}: {len(df)} bars from {first_dt} to {last_dt} -> {out_path}")

if __name__ == "__main__":
    download_ohlcv()
