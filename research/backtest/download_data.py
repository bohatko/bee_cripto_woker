"""
Data Downloader for Bee Crypto Worker Backtest.
Downloads 1m OHLCV and funding rate history from Binance USDM (via CCXT public API).
Supports both In-Sample (2026-03-01 .. 2026-09-04) and Out-Of-Sample (2025-08-20 .. 2026-03-01).
"""

import os
import sys
import time
import argparse
from datetime import datetime, timezone
import ccxt
import pandas as pd
import numpy as np

COINS = ['ZEC', 'AVAX', 'ENA', 'SUI', 'SOL', 'ADA', 'BNB', 'ETH']
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data'))


def get_timestamps(start_str: str, end_str: str):
    start_dt = datetime.strptime(start_str, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
    end_dt = datetime.strptime(end_str, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
    start_ts = int(start_dt.timestamp() * 1000)
    end_ts = int(end_dt.timestamp() * 1000)
    return start_ts, end_ts


def download_1m_ohlcv(
    exchange: ccxt.binanceusdm,
    coin: str,
    start_ts: int,
    end_ts: int,
    start_str: str,
    end_str: str,
    prefix: str = '',
    force: bool = False
) -> pd.DataFrame:
    file_name = f'1m_{coin}{prefix}.parquet'
    parquet_path = os.path.join(DATA_DIR, file_name)
    if os.path.exists(parquet_path) and not force:
        print(f"[{coin}] 1m data already cached at {parquet_path}, loading...")
        df = pd.read_parquet(parquet_path)
        return df

    symbol_raw = f"{coin}USDT"
    print(f"[{coin}] Downloading 1m OHLCV from {start_str} to {end_str}...")

    all_klines = []
    cur_ts = start_ts
    limit = 1500

    batch_count = 0
    while cur_ts < end_ts:
        try:
            res = exchange.fapiPublicGetKlines({
                'symbol': symbol_raw,
                'interval': '1m',
                'startTime': cur_ts,
                'endTime': end_ts,
                'limit': limit
            })
            if not res or len(res) == 0:
                break

            for k in res:
                all_klines.append([
                    int(k[0]),
                    float(k[1]),
                    float(k[2]),
                    float(k[3]),
                    float(k[4]),
                    float(k[5])
                ])

            last_open_time = int(res[-1][0])
            if last_open_time <= cur_ts:
                break
            cur_ts = last_open_time + 60_000
            batch_count += 1

            if batch_count % 30 == 0:
                pct = min(100.0, (cur_ts - start_ts) / (end_ts - start_ts) * 100)
                print(f"[{coin}] Progress: {pct:.1f}% ({len(all_klines)} bars)...")

            time.sleep(0.05)

        except Exception as e:
            print(f"[{coin}] Error fetching klines at ts={cur_ts}: {e}. Retrying in 2s...")
            time.sleep(2.0)

    if not all_klines:
        raise ValueError(f"No klines fetched for {coin}")

    df = pd.DataFrame(all_klines, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df.drop_duplicates(subset=['timestamp'], inplace=True)
    df.sort_values(by='timestamp', inplace=True)
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True)
    df.reset_index(drop=True, inplace=True)

    df.to_parquet(parquet_path, index=False)
    print(f"[{coin}] Saved {len(df)} 1m bars to {parquet_path}. Range: {df['datetime'].iloc[0]} -> {df['datetime'].iloc[-1]}")
    return df


def download_funding_history(
    exchange: ccxt.binanceusdm,
    coin: str,
    start_ts: int,
    end_ts: int,
    prefix: str = '',
    force: bool = False
) -> pd.DataFrame:
    file_name = f'funding_{coin}{prefix}.csv'
    csv_path = os.path.join(DATA_DIR, file_name)
    if os.path.exists(csv_path) and not force:
        print(f"[{coin}] Funding data already cached at {csv_path}, loading...")
        df = pd.read_csv(csv_path)
        return df

    symbol_raw = f"{coin}USDT"
    print(f"[{coin}] Downloading funding rate history...")

    all_funding = []
    cur_ts = start_ts
    limit = 1000

    while cur_ts < end_ts:
        try:
            res = exchange.fapiPublicGetFundingRate({
                'symbol': symbol_raw,
                'startTime': cur_ts,
                'endTime': end_ts,
                'limit': limit
            })
            if not res or len(res) == 0:
                break

            for f in res:
                all_funding.append({
                    'timestamp': int(f['fundingTime']),
                    'funding_rate': float(f['fundingRate']),
                    'mark_price': float(f.get('markPrice', 0.0))
                })

            last_ts = int(res[-1]['fundingTime'])
            if last_ts <= cur_ts:
                break
            cur_ts = last_ts + 1
            if len(res) < limit:
                break
            time.sleep(0.05)
        except Exception as e:
            print(f"[{coin}] Error fetching funding rates at ts={cur_ts}: {e}. Retrying in 2s...")
            time.sleep(2.0)

    if not all_funding:
        print(f"[{coin}] Warning: No funding history found.")
        df = pd.DataFrame(columns=['timestamp', 'datetime', 'funding_rate', 'mark_price'])
    else:
        df = pd.DataFrame(all_funding)
        df.drop_duplicates(subset=['timestamp'], inplace=True)
        df.sort_values(by='timestamp', inplace=True)
        df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True)
        df.reset_index(drop=True, inplace=True)

    df.to_csv(csv_path, index=False)
    print(f"[{coin}] Saved {len(df)} funding records to {csv_path}")
    return df


def main():
    parser = argparse.ArgumentParser(description="Download Binance USDM 1m OHLCV and Funding History")
    parser.add_argument('--period', type=str, default='all', choices=['in_sample', 'oos', 'all'], help="Period to download")
    parser.add_argument('--force', action='store_true', help="Force re-download even if cached")
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)

    exchange = ccxt.binanceusdm({
        'enableRateLimit': True,
        'timeout': 20000,
    })

    periods_to_run = []
    if args.period in ['in_sample', 'all']:
        periods_to_run.append({
            'name': 'in_sample',
            'start_str': '2026-03-01 00:00:00',
            'end_str': '2026-09-04 00:00:00',
            'prefix': '',
        })
    if args.period in ['oos', 'all']:
        periods_to_run.append({
            'name': 'oos',
            'start_str': '2025-08-20 00:00:00',  # includes warm-up for 2025-09-01
            'end_str': '2026-03-01 00:00:00',
            'prefix': '_oos',
        })

    for p in periods_to_run:
        start_ts, end_ts = get_timestamps(p['start_str'], p['end_str'])
        print(f"\n================ STARTING DOWNLOAD: {p['name']} ({p['start_str']} -> {p['end_str']}) ================")

        summary = []
        for coin in COINS:
            print(f"\n--- Processing {coin} [{p['name']}] ---")
            df_1m = download_1m_ohlcv(
                exchange, coin, start_ts, end_ts, p['start_str'], p['end_str'],
                prefix=p['prefix'], force=args.force
            )
            df_funding = download_funding_history(
                exchange, coin, start_ts, end_ts,
                prefix=p['prefix'], force=args.force
            )
            summary.append({
                'coin': coin,
                'bars_1m': len(df_1m),
                'first_bar': str(df_1m['datetime'].iloc[0]) if len(df_1m) > 0 else 'N/A',
                'last_bar': str(df_1m['datetime'].iloc[-1]) if len(df_1m) > 0 else 'N/A',
                'funding_records': len(df_funding)
            })

        print(f"\n================ DATA SUMMARY [{p['name']}] ================")
        summary_df = pd.DataFrame(summary)
        print(summary_df.to_string(index=False))
        print("========================================================\n")


if __name__ == '__main__':
    main()
