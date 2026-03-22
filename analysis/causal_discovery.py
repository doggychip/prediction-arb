"""
Phase 1 (Refined): Causal Discovery for Prediction Market Arbitrage
====================================================================
Improvements over v1:
  - Handles sparse signal (94.6% of spreads are 0) via regime-based analysis
  - Adds nonlinear causality (mutual information, HSIC kernel test)
  - Adds temporal feature engineering (rolling stats, rate-of-change, regime transitions)
  - Adds permutation-based significance testing
  - Focuses deep analysis on high-variance pairs only
  - Adds lagged cross-correlation for lead/lag detection

Methods:
  1. Data quality assessment + smart pair selection
  2. Temporal feature engineering (rolling, diff, regime)
  3. Granger causality (linear, on filtered high-variance pairs)
  4. Nonlinear causality (mutual information + kernel HSIC)
  5. Transfer entropy (with permutation significance)
  6. Regime transition analysis (what precedes spread appearance?)
  7. PC algorithm (constraint-based DAG)
  8. Synthesis with confidence intervals
"""

import sqlite3
import pandas as pd
import numpy as np
from scipy import stats
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mutual_info_score
from itertools import combinations
from pathlib import Path
import json
import warnings
warnings.filterwarnings('ignore')

DB_PATH = Path(__file__).parent.parent / "data" / "arb.db"
OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

np.random.seed(42)


# ============================================================
# 1. DATA LOADING + QUALITY ASSESSMENT
# ============================================================

def load_and_assess():
    """Load raw data and assess quality before analysis."""
    conn = sqlite3.connect(str(DB_PATH))

    df_snap = pd.read_sql_query("""
        SELECT
            ps.pair_id,
            ps.kalshi_yes_bid, ps.kalshi_yes_ask,
            ps.poly_yes_bid, ps.poly_yes_ask,
            ps.spread_cents, ps.timestamp,
            mp.match_confidence,
            km.volume AS kalshi_volume,
            km.volume_24h AS kalshi_vol_24h,
            km.open_interest,
            CAST(pm.volume_24hr AS REAL) AS poly_vol_24h,
            CAST(pm.liquidity AS REAL) AS poly_liquidity
        FROM price_snapshots ps
        JOIN market_pairs mp ON ps.pair_id = mp.id
        JOIN kalshi_markets km ON mp.kalshi_ticker = km.ticker
        JOIN polymarket_markets pm ON mp.polymarket_id = pm.id
        ORDER BY ps.pair_id, ps.timestamp
    """, conn)

    df_arb = pd.read_sql_query("""
        SELECT ao.*, mp.match_confidence,
               km.volume AS kalshi_volume, km.open_interest,
               CAST(pm.volume_24hr AS REAL) AS poly_vol_24h,
               CAST(pm.liquidity AS REAL) AS poly_liquidity
        FROM arb_opportunities ao
        JOIN market_pairs mp ON ao.pair_id = mp.id
        JOIN kalshi_markets km ON ao.kalshi_ticker = km.ticker
        JOIN polymarket_markets pm ON ao.polymarket_id = pm.id
        ORDER BY ao.detected_at
    """, conn)
    conn.close()

    df_snap['timestamp'] = pd.to_datetime(df_snap['timestamp'])
    df_arb['detected_at'] = pd.to_datetime(df_arb['detected_at'])

    # Quality assessment
    total = len(df_snap)
    zero_spread = (df_snap['spread_cents'] == 0).sum()
    nonzero_spread = (df_snap['spread_cents'] != 0).sum()

    print("=" * 60)
    print("DATA QUALITY ASSESSMENT")
    print("=" * 60)
    print(f"Total snapshots:     {total:,}")
    print(f"Zero spread:         {zero_spread:,} ({zero_spread/total:.1%})")
    print(f"Non-zero spread:     {nonzero_spread:,} ({nonzero_spread/total:.1%})")
    print(f"Unique pairs:        {df_snap['pair_id'].nunique()}")
    print(f"Time range:          {df_snap['timestamp'].min()} → {df_snap['timestamp'].max()}")

    # Identify high-quality pairs for deep analysis
    pair_quality = df_snap.groupby('pair_id').agg(
        n_snapshots=('spread_cents', 'size'),
        n_unique_spread=('spread_cents', 'nunique'),
        max_spread=('spread_cents', 'max'),
        std_spread=('spread_cents', 'std'),
        pct_nonzero=('spread_cents', lambda x: (x != 0).mean()),
    ).sort_values('std_spread', ascending=False)

    # Tier 1: pairs with real spread variation
    tier1 = pair_quality[
        (pair_quality['n_unique_spread'] >= 5) &
        (pair_quality['n_snapshots'] >= 50)
    ]
    # Tier 2: pairs with some spread events (binary: 0 vs nonzero)
    tier2 = pair_quality[
        (pair_quality['pct_nonzero'] >= 0.01) &
        (pair_quality['n_snapshots'] >= 100) &
        (~pair_quality.index.isin(tier1.index))
    ]
    # Tier 3: all pairs with enough data
    tier3 = pair_quality[
        (pair_quality['n_snapshots'] >= 50) &
        (~pair_quality.index.isin(tier1.index)) &
        (~pair_quality.index.isin(tier2.index))
    ]

    print(f"\nPair tiers:")
    print(f"  Tier 1 (high variance, deep causal): {len(tier1)} pairs")
    print(f"  Tier 2 (binary spread events):       {len(tier2)} pairs")
    print(f"  Tier 3 (low/no variance):            {len(tier3)} pairs")

    if len(tier1) > 0:
        print(f"\n  Tier 1 details:")
        for pid, row in tier1.head(10).iterrows():
            print(f"    {pid[:16]}  n={row['n_snapshots']:5.0f}  "
                  f"unique={row['n_unique_spread']:.0f}  "
                  f"max={row['max_spread']:.0f}  "
                  f"std={row['std_spread']:.2f}  "
                  f"nonzero={row['pct_nonzero']:.1%}")

    return df_snap, df_arb, tier1, tier2


# ============================================================
# 2. TEMPORAL FEATURE ENGINEERING
# ============================================================

def engineer_temporal_features(df_snap, pair_ids):
    """Build time-series features per pair: rolling stats, diffs, regimes."""
    all_pair_dfs = []

    for pair_id in pair_ids:
        pdf = df_snap[df_snap['pair_id'] == pair_id].sort_values('timestamp').copy()
        if len(pdf) < 20:
            continue

        # Basic derived
        pdf['kalshi_ba_spread'] = pdf['kalshi_yes_ask'] - pdf['kalshi_yes_bid']
        pdf['poly_ba_spread'] = pdf['poly_yes_ask'] - pdf['poly_yes_bid']
        pdf['kalshi_mid'] = (pdf['kalshi_yes_bid'] + pdf['kalshi_yes_ask']) / 2
        pdf['poly_mid'] = (pdf['poly_yes_bid'] + pdf['poly_yes_ask']) / 2
        pdf['mid_divergence'] = pdf['kalshi_mid'] - pdf['poly_mid']
        pdf['hour'] = pdf['timestamp'].dt.hour

        # Rate of change (first differences)
        pdf['d_kalshi_mid'] = pdf['kalshi_mid'].diff()
        pdf['d_poly_mid'] = pdf['poly_mid'].diff()
        pdf['d_spread'] = pdf['spread_cents'].diff()
        pdf['d_kalshi_ba'] = pdf['kalshi_ba_spread'].diff()
        pdf['d_poly_ba'] = pdf['poly_ba_spread'].diff()

        # Rolling statistics (window=5 and 10)
        for w in [5, 10]:
            pdf[f'spread_roll_mean_{w}'] = pdf['spread_cents'].rolling(w, min_periods=2).mean()
            pdf[f'spread_roll_std_{w}'] = pdf['spread_cents'].rolling(w, min_periods=2).std()
            pdf[f'kalshi_ba_roll_{w}'] = pdf['kalshi_ba_spread'].rolling(w, min_periods=2).mean()
            pdf[f'poly_ba_roll_{w}'] = pdf['poly_ba_spread'].rolling(w, min_periods=2).mean()
            pdf[f'mid_div_roll_{w}'] = pdf['mid_divergence'].rolling(w, min_periods=2).mean()

        # Regime: is spread currently active?
        pdf['spread_active'] = (pdf['spread_cents'] > 0).astype(int)
        # Regime transitions
        pdf['spread_onset'] = (pdf['spread_active'].diff() == 1).astype(int)
        pdf['spread_close'] = (pdf['spread_active'].diff() == -1).astype(int)

        # Liquidity features
        poly_liq = pdf['poly_liquidity'].iloc[0] if pdf['poly_liquidity'].iloc[0] > 0 else 1
        pdf['liquidity_ratio'] = poly_liq / pdf['kalshi_volume'].clip(lower=1)
        pdf['volume_imbalance'] = (
            (pdf['kalshi_vol_24h'] - pdf['poly_vol_24h']) /
            (pdf['kalshi_vol_24h'] + pdf['poly_vol_24h']).clip(lower=1)
        )

        all_pair_dfs.append(pdf)

    if not all_pair_dfs:
        return pd.DataFrame()

    result = pd.concat(all_pair_dfs, ignore_index=True)
    print(f"\nEngineered features for {len(all_pair_dfs)} pairs, {len(result)} rows total")
    return result


# ============================================================
# 3. GRANGER CAUSALITY (on high-variance pairs only)
# ============================================================

def granger_causality_test(series_x, series_y, max_lag=5):
    """Granger F-test: does X improve prediction of Y beyond Y's own lags?"""
    from numpy.linalg import lstsq

    n = len(series_x)
    best_f, best_p, best_lag = 0, 1.0, 1

    for lag in range(1, max_lag + 1):
        if n <= 2 * lag + 2:
            continue

        Y = series_y[lag:]
        Y_lags = np.column_stack([series_y[lag-i-1:n-i-1] for i in range(lag)])
        ones = np.ones((len(Y), 1))
        X_restricted = np.hstack([ones, Y_lags])
        X_lags = np.column_stack([series_x[lag-i-1:n-i-1] for i in range(lag)])
        X_unrestricted = np.hstack([ones, Y_lags, X_lags])

        res_r, _, _, _ = lstsq(X_restricted, Y, rcond=None)
        res_u, _, _, _ = lstsq(X_unrestricted, Y, rcond=None)

        rss_r = np.sum((Y - X_restricted @ res_r) ** 2)
        rss_u = np.sum((Y - X_unrestricted @ res_u) ** 2)

        n_obs = len(Y)
        df1 = X_unrestricted.shape[1] - X_restricted.shape[1]
        df2 = n_obs - X_unrestricted.shape[1]

        if rss_u <= 0 or df2 <= 0 or df1 <= 0:
            continue

        f_stat = ((rss_r - rss_u) / df1) / (rss_u / df2)
        p_value = 1 - stats.f.cdf(f_stat, df1, df2)

        if f_stat > best_f:
            best_f, best_p, best_lag = f_stat, p_value, lag

    return best_f, best_p, best_lag


def run_granger_analysis(df_feat, tier1_ids):
    """Granger causality focused on tier-1 high-variance pairs."""
    print("\n" + "=" * 60)
    print("GRANGER CAUSALITY (high-variance pairs only)")
    print("=" * 60)

    features = [
        'kalshi_ba_spread', 'poly_ba_spread', 'mid_divergence',
        'kalshi_mid', 'poly_mid',
        'd_kalshi_mid', 'd_poly_mid', 'd_kalshi_ba', 'd_poly_ba',
    ]
    target = 'spread_cents'
    results = []

    for pair_id in tier1_ids:
        pdf = df_feat[df_feat['pair_id'] == pair_id].sort_values('timestamp').dropna(
            subset=[target] + features
        )
        if len(pdf) < 30:
            continue

        for feature in features:
            x = pdf[feature].values.astype(float)
            y = pdf[target].values.astype(float)

            if np.std(x) < 1e-10 or np.std(y) < 1e-10:
                continue

            f_fwd, p_fwd, lag_fwd = granger_causality_test(x, y)
            f_rev, p_rev, lag_rev = granger_causality_test(y, x)

            if p_fwd < 0.05 and f_fwd > f_rev:
                direction = 'CAUSES_SPREAD'
            elif p_rev < 0.05 and f_rev > f_fwd:
                direction = 'CAUSED_BY_SPREAD'
            elif p_fwd < 0.05 and p_rev < 0.05:
                direction = 'BIDIRECTIONAL'
            else:
                direction = 'NO_LINK'

            results.append({
                'pair_id': pair_id[:12],
                'feature': feature,
                'f_forward': round(f_fwd, 3),
                'p_forward': round(p_fwd, 4),
                'lag_forward': lag_fwd,
                'f_reverse': round(f_rev, 3),
                'p_reverse': round(p_rev, 4),
                'direction': direction,
            })

    df_gc = pd.DataFrame(results)
    if len(df_gc) > 0:
        summary = df_gc.groupby(['feature', 'direction']).size().unstack(fill_value=0)
        print("\n--- Direction counts ---")
        print(summary.to_string())

        sig = df_gc[df_gc['direction'] == 'CAUSES_SPREAD']
        if len(sig) > 0:
            print("\n--- Top causal drivers (Granger) ---")
            ranked = sig.groupby('feature')['f_forward'].agg(['mean', 'count']).sort_values('mean', ascending=False)
            print(ranked.to_string())
    else:
        print("  No significant Granger links (limited high-variance pairs)")

    return df_gc


# ============================================================
# 4. NONLINEAR CAUSALITY
# ============================================================

def compute_lagged_mi(x, y, lag=1, bins=8):
    """Mutual information between x_{t-lag} and y_t (nonlinear dependence)."""
    n = len(x)
    if n < lag + 20:
        return 0.0

    x_lagged = x[:-lag] if lag > 0 else x
    y_current = y[lag:] if lag > 0 else y

    # Remove NaN
    mask = ~(np.isnan(x_lagged) | np.isnan(y_current))
    x_lagged = x_lagged[mask]
    y_current = y_current[mask]

    if len(x_lagged) < 20 or np.std(x_lagged) < 1e-10 or np.std(y_current) < 1e-10:
        return 0.0

    # Discretize for MI estimation
    try:
        x_binned = pd.qcut(x_lagged, q=bins, labels=False, duplicates='drop')
        y_binned = pd.qcut(y_current, q=bins, labels=False, duplicates='drop')
    except ValueError:
        return 0.0

    mask2 = ~(np.isnan(x_binned) | np.isnan(y_binned))
    if mask2.sum() < 20:
        return 0.0

    return mutual_info_score(x_binned[mask2], y_binned[mask2])


def hsic_test(x, y, sigma_x=None, sigma_y=None):
    """
    Hilbert-Schmidt Independence Criterion (kernel-based nonlinear dependence).
    Uses RBF kernel. Returns HSIC statistic (higher = more dependent).
    """
    n = len(x)
    if n < 20:
        return 0.0, 1.0

    x = x.reshape(-1, 1) if x.ndim == 1 else x
    y = y.reshape(-1, 1) if y.ndim == 1 else y

    # RBF kernel with median heuristic
    if sigma_x is None:
        dists_x = np.abs(x - x.T)
        sigma_x = np.median(dists_x[dists_x > 0]) + 1e-10
    if sigma_y is None:
        dists_y = np.abs(y - y.T)
        sigma_y = np.median(dists_y[dists_y > 0]) + 1e-10

    K = np.exp(-0.5 * (x - x.T) ** 2 / sigma_x ** 2)
    L = np.exp(-0.5 * (y - y.T) ** 2 / sigma_y ** 2)

    # Center the kernels
    H = np.eye(n) - np.ones((n, n)) / n
    Kc = H @ K @ H
    Lc = H @ L @ H

    # HSIC = trace(Kc @ Lc) / (n-1)^2
    hsic_stat = np.trace(Kc @ Lc) / ((n - 1) ** 2)

    # Permutation test for p-value (fast, 200 permutations)
    null_dist = []
    for _ in range(200):
        perm = np.random.permutation(n)
        L_perm = L[perm][:, perm]
        Lc_perm = H @ L_perm @ H
        null_dist.append(np.trace(Kc @ Lc_perm) / ((n - 1) ** 2))

    p_value = np.mean(np.array(null_dist) >= hsic_stat)
    return hsic_stat, p_value


def run_nonlinear_analysis(df_feat, tier1_ids, tier2_ids):
    """Mutual information + HSIC for nonlinear causal discovery."""
    print("\n" + "=" * 60)
    print("NONLINEAR CAUSALITY (MI + HSIC)")
    print("=" * 60)

    features = [
        'kalshi_ba_spread', 'poly_ba_spread', 'mid_divergence',
        'kalshi_mid', 'poly_mid',
        'd_kalshi_mid', 'd_poly_mid',
    ]
    target = 'spread_cents'
    all_pairs = list(tier1_ids) + list(tier2_ids[:10])
    results = []

    for pair_id in all_pairs:
        pdf = df_feat[df_feat['pair_id'] == pair_id].sort_values('timestamp').dropna(
            subset=[target] + features
        )
        if len(pdf) < 30:
            continue

        y = pdf[target].values.astype(float)

        for feature in features:
            x = pdf[feature].values.astype(float)
            if np.std(x) < 1e-10 or np.std(y) < 1e-10:
                continue

            # Lagged MI: x_{t-1} → y_t vs y_{t-1} → x_t
            mi_fwd = compute_lagged_mi(x, y, lag=1)
            mi_rev = compute_lagged_mi(y, x, lag=1)

            # HSIC on lagged data (subsample for speed)
            n = min(len(x) - 1, 300)
            if n >= 30:
                x_lag = x[:n]
                y_cur = y[1:n+1]
                hsic_fwd, hsic_p = hsic_test(x_lag, y_cur)

                y_lag = y[:n]
                x_cur = x[1:n+1]
                hsic_rev, hsic_p_rev = hsic_test(y_lag, x_cur)
            else:
                hsic_fwd, hsic_p, hsic_rev, hsic_p_rev = 0, 1, 0, 1

            results.append({
                'pair_id': pair_id[:12],
                'feature': feature,
                'mi_forward': round(mi_fwd, 4),
                'mi_reverse': round(mi_rev, 4),
                'mi_net': round(mi_fwd - mi_rev, 4),
                'hsic_forward': round(hsic_fwd, 6),
                'hsic_p': round(hsic_p, 4),
                'hsic_reverse': round(hsic_rev, 6),
                'hsic_direction': 'CAUSES' if (hsic_fwd > hsic_rev * 1.1 and hsic_p < 0.05)
                                  else 'CAUSED_BY' if (hsic_rev > hsic_fwd * 1.1 and hsic_p_rev < 0.05)
                                  else 'UNCLEAR',
            })

    df_nl = pd.DataFrame(results)
    if len(df_nl) > 0:
        summary = df_nl.groupby('feature').agg({
            'mi_forward': 'mean',
            'mi_reverse': 'mean',
            'mi_net': 'mean',
            'hsic_forward': 'mean',
            'hsic_reverse': 'mean',
        }).sort_values('mi_net', ascending=False)
        summary['mi_ratio'] = summary['mi_forward'] / summary['mi_reverse'].clip(lower=0.001)
        summary['hsic_ratio'] = summary['hsic_forward'] / summary['hsic_reverse'].clip(lower=1e-10)

        print("\n--- Nonlinear Causality Summary ---")
        print(summary.round(4).to_string())
        print("\n  mi_net > 0 ⟹ feature leads spread (nonlinear)")
        print("  hsic_ratio > 1 ⟹ stronger forward nonlinear dependence")
    else:
        print("  No nonlinear results (insufficient data)")

    return df_nl


# ============================================================
# 5. TRANSFER ENTROPY (with permutation significance)
# ============================================================

def transfer_entropy(source, target, lag=1, bins=8):
    """Transfer entropy T_{X→Y} with binned estimation."""
    n = len(source)
    if n < lag + 10:
        return 0.0

    try:
        src_binned = pd.qcut(source, q=bins, labels=False, duplicates='drop')
        tgt_binned = pd.qcut(target, q=bins, labels=False, duplicates='drop')
    except ValueError:
        return 0.0

    y_t = np.asarray(tgt_binned[lag:])
    y_past = np.asarray(tgt_binned[:-lag])
    x_past = np.asarray(src_binned[:-lag])

    df_r = pd.DataFrame({'y_t': y_t, 'y_past': y_past}).dropna()
    df_f = pd.DataFrame({'y_t': y_t, 'y_past': y_past, 'x_past': x_past}).dropna()

    if len(df_r) < 10 or len(df_f) < 10:
        return 0.0

    joint_r = df_r.groupby(['y_t', 'y_past']).size()
    p_joint_r = joint_r / joint_r.sum()
    marginal_r = df_r.groupby('y_past').size()
    p_marginal_r = marginal_r / marginal_r.sum()

    h_r = 0
    for (yt, yp), p in p_joint_r.items():
        if p > 0 and p_marginal_r.get(yp, 0) > 0:
            h_r -= p * np.log2(p / p_marginal_r[yp])

    joint_u = df_f.groupby(['y_t', 'y_past', 'x_past']).size()
    p_joint_u = joint_u / joint_u.sum()
    marginal_u = df_f.groupby(['y_past', 'x_past']).size()
    p_marginal_u = marginal_u / marginal_u.sum()

    h_u = 0
    for (yt, yp, xp), p in p_joint_u.items():
        if p > 0 and p_marginal_u.get((yp, xp), 0) > 0:
            h_u -= p * np.log2(p / p_marginal_u[(yp, xp)])

    return max(h_r - h_u, 0)


def transfer_entropy_with_significance(source, target, lag=1, bins=8, n_perm=100):
    """TE with permutation-based p-value."""
    te_real = transfer_entropy(source, target, lag, bins)

    # Null distribution: shuffle source to break temporal dependence
    null_tes = []
    for _ in range(n_perm):
        perm_source = np.random.permutation(source)
        null_tes.append(transfer_entropy(perm_source, target, lag, bins))

    null_tes = np.array(null_tes)
    p_value = np.mean(null_tes >= te_real)
    z_score = (te_real - np.mean(null_tes)) / (np.std(null_tes) + 1e-10)

    return te_real, p_value, z_score


def run_te_analysis(df_feat, tier1_ids, tier2_ids):
    """Transfer entropy with permutation tests."""
    print("\n" + "=" * 60)
    print("TRANSFER ENTROPY (with permutation significance)")
    print("=" * 60)

    features = [
        'kalshi_ba_spread', 'poly_ba_spread', 'kalshi_mid', 'poly_mid',
        'mid_divergence', 'd_kalshi_mid', 'd_poly_mid',
    ]
    target = 'spread_cents'
    all_pairs = list(tier1_ids) + list(tier2_ids[:10])
    results = []

    for pair_id in all_pairs:
        pdf = df_feat[df_feat['pair_id'] == pair_id].sort_values('timestamp').dropna(
            subset=[target] + features
        )
        if len(pdf) < 30:
            continue

        for feature in features:
            src = pdf[feature].values.astype(float)
            tgt = pdf[target].values.astype(float)

            if np.std(src) < 1e-10 or np.std(tgt) < 1e-10:
                continue

            te_fwd, p_fwd, z_fwd = transfer_entropy_with_significance(src, tgt, n_perm=50)
            te_rev, p_rev, z_rev = transfer_entropy_with_significance(tgt, src, n_perm=50)

            results.append({
                'pair_id': pair_id[:12],
                'feature': feature,
                'te_forward': round(te_fwd, 4),
                'te_p_forward': round(p_fwd, 4),
                'te_z_forward': round(z_fwd, 2),
                'te_reverse': round(te_rev, 4),
                'te_p_reverse': round(p_rev, 4),
                'net_te': round(te_fwd - te_rev, 4),
                'significant': p_fwd < 0.05,
                'direction': ('CAUSES' if (te_fwd > te_rev and p_fwd < 0.05)
                              else 'CAUSED_BY' if (te_rev > te_fwd and p_rev < 0.05)
                              else 'NS'),
            })

    df_te = pd.DataFrame(results)
    if len(df_te) > 0:
        summary = df_te.groupby('feature').agg({
            'te_forward': 'mean',
            'te_reverse': 'mean',
            'net_te': 'mean',
            'te_z_forward': 'mean',
            'significant': 'mean',
        }).sort_values('net_te', ascending=False)
        summary.columns = ['te_fwd', 'te_rev', 'net_te', 'avg_z', 'pct_significant']
        print("\n--- Transfer Entropy Summary ---")
        print(summary.round(4).to_string())
    else:
        print("  No TE results")

    return df_te


# ============================================================
# 6. REGIME TRANSITION ANALYSIS
# ============================================================

def run_regime_analysis(df_feat, tier1_ids, tier2_ids):
    """What conditions precede spread onset vs closure?"""
    print("\n" + "=" * 60)
    print("REGIME TRANSITION ANALYSIS")
    print("=" * 60)
    print("(What precedes spread_onset=1 vs normal spread_active=0?)")

    all_pairs = list(tier1_ids) + list(tier2_ids[:15])
    onset_features = []
    close_features = []

    precursor_cols = [
        'kalshi_ba_spread', 'poly_ba_spread', 'mid_divergence',
        'kalshi_mid', 'poly_mid', 'liquidity_ratio', 'volume_imbalance',
    ]

    for pair_id in all_pairs:
        pdf = df_feat[df_feat['pair_id'] == pair_id].sort_values('timestamp')
        if len(pdf) < 20:
            continue

        # Get onset events and preceding window
        onset_idx = pdf.index[pdf['spread_onset'] == 1]
        close_idx = pdf.index[pdf['spread_close'] == 1]
        quiet_idx = pdf.index[(pdf['spread_active'] == 0) & (pdf['spread_onset'] == 0)]

        for idx in onset_idx:
            pos = pdf.index.get_loc(idx)
            if pos >= 3:
                # Features at t-1 before onset
                row = pdf.iloc[pos - 1]
                onset_features.append({col: row.get(col, np.nan) for col in precursor_cols})

        for idx in close_idx:
            pos = pdf.index.get_loc(idx)
            if pos >= 3:
                row = pdf.iloc[pos - 1]
                close_features.append({col: row.get(col, np.nan) for col in precursor_cols})

    df_onset = pd.DataFrame(onset_features)
    df_close = pd.DataFrame(close_features)

    # Also get baseline (quiet periods)
    all_quiet = []
    for pair_id in all_pairs[:5]:
        pdf = df_feat[df_feat['pair_id'] == pair_id].sort_values('timestamp')
        quiet = pdf[(pdf['spread_active'] == 0) & (pdf['spread_onset'] == 0)]
        if len(quiet) > 0:
            all_quiet.append(quiet[precursor_cols].sample(min(100, len(quiet))))
    df_quiet = pd.concat(all_quiet) if all_quiet else pd.DataFrame()

    print(f"\n  Onset events:  {len(df_onset)}")
    print(f"  Close events:  {len(df_close)}")
    print(f"  Quiet samples: {len(df_quiet)}")

    regime_results = {}

    if len(df_onset) >= 5 and len(df_quiet) >= 10:
        print("\n--- Pre-Onset vs Quiet (what triggers spreads?) ---")
        for col in precursor_cols:
            onset_vals = df_onset[col].dropna()
            quiet_vals = df_quiet[col].dropna()
            if len(onset_vals) >= 3 and len(quiet_vals) >= 3:
                stat, p = stats.mannwhitneyu(onset_vals, quiet_vals, alternative='two-sided')
                effect = onset_vals.mean() - quiet_vals.mean()
                sig = "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else ""
                print(f"  {col:25s}  onset_mean={onset_vals.mean():8.2f}  "
                      f"quiet_mean={quiet_vals.mean():8.2f}  "
                      f"diff={effect:+7.2f}  p={p:.4f} {sig}")
                regime_results[col] = {
                    'onset_mean': round(float(onset_vals.mean()), 3),
                    'quiet_mean': round(float(quiet_vals.mean()), 3),
                    'effect': round(float(effect), 3),
                    'p_value': round(float(p), 4),
                    'significant': p < 0.05,
                }
    else:
        print("  Insufficient onset events for regime analysis")

    if len(df_close) >= 5 and len(df_onset) >= 5:
        print("\n--- Pre-Close vs Pre-Onset (what kills vs creates spreads?) ---")
        for col in precursor_cols:
            close_vals = df_close[col].dropna()
            onset_vals = df_onset[col].dropna()
            if len(close_vals) >= 3 and len(onset_vals) >= 3:
                stat, p = stats.mannwhitneyu(close_vals, onset_vals, alternative='two-sided')
                print(f"  {col:25s}  close={close_vals.mean():8.2f}  "
                      f"onset={onset_vals.mean():8.2f}  p={p:.4f}")

    return regime_results


# ============================================================
# 7. PC ALGORITHM
# ============================================================

def conditional_independence_test(data, x, y, z_set, alpha=0.05):
    """Partial correlation CI test with Fisher Z-transform."""
    if len(z_set) == 0:
        r, p = stats.pearsonr(data[x], data[y])
        return p > alpha, p

    from numpy.linalg import lstsq

    Z = data[list(z_set)].values
    ones = np.ones((len(Z), 1))
    Z_aug = np.hstack([ones, Z])

    x_vals = data[x].values
    coef_x, _, _, _ = lstsq(Z_aug, x_vals, rcond=None)
    res_x = x_vals - Z_aug @ coef_x

    y_vals = data[y].values
    coef_y, _, _, _ = lstsq(Z_aug, y_vals, rcond=None)
    res_y = y_vals - Z_aug @ coef_y

    if np.std(res_x) < 1e-10 or np.std(res_y) < 1e-10:
        return True, 1.0

    r, _ = stats.pearsonr(res_x, res_y)
    n = len(data) - len(z_set)
    if n <= 3:
        return True, 1.0
    z_score = 0.5 * np.log((1 + r) / (1 - r + 1e-10)) * np.sqrt(n - len(z_set) - 3)
    p_value = 2 * (1 - stats.norm.cdf(abs(z_score)))
    return p_value > alpha, p_value


def pc_algorithm(data, variables, alpha=0.05, max_cond_set=3):
    """PC algorithm for causal DAG discovery."""
    print("\n" + "=" * 60)
    print("PC ALGORITHM - CAUSAL DAG")
    print("=" * 60)

    n_vars = len(variables)
    edges = set()
    for i, j in combinations(range(n_vars), 2):
        edges.add((i, j))

    sep_sets = {}

    for cond_size in range(0, max_cond_set + 1):
        to_remove = []
        for (i, j) in list(edges):
            neighbors_i = [k for (a, b) in edges
                          for k in ([b] if a == i else [a] if b == i else [])
                          if k != j]
            if len(neighbors_i) < cond_size:
                continue
            for z_idx in combinations(neighbors_i, cond_size):
                z_vars = [variables[k] for k in z_idx]
                indep, p = conditional_independence_test(data, variables[i], variables[j], z_vars, alpha)
                if indep:
                    to_remove.append((i, j))
                    sep_sets[(i, j)] = set(z_idx)
                    sep_sets[(j, i)] = set(z_idx)
                    break
        for e in to_remove:
            edges.discard(e)

    # Orient v-structures
    directed = {}
    for (i, j) in list(edges):
        ni = set(k for (a, b) in edges for k in ([b] if a == i else [a] if b == i else []) if k != j)
        nj = set(k for (a, b) in edges for k in ([b] if a == j else [a] if b == j else []) if k != i)
        for k in ni & nj:
            if k not in sep_sets.get((i, j), set()):
                directed[(i, k)] = '→'
                directed[(j, k)] = '→'

    graph = []
    print(f"\n  {len(edges)} edges among {n_vars} variables:")
    for (i, j) in sorted(edges):
        if (i, j) in directed and (j, i) in directed:
            disp = f"{variables[i]} → {variables[j]} (collider)"
        elif (i, j) in directed:
            disp = f"{variables[i]} → {variables[j]}"
        elif (j, i) in directed:
            disp = f"{variables[j]} → {variables[i]}"
        else:
            disp = f"{variables[i]} — {variables[j]}"
        graph.append({'from': variables[i], 'to': variables[j],
                      'directed': (i, j) in directed or (j, i) in directed,
                      'display': disp})
        print(f"    {disp}")

    return graph, edges, directed


# ============================================================
# 8. LAGGED CROSS-CORRELATION
# ============================================================

def run_lead_lag_analysis(df_feat, tier1_ids):
    """Find which features lead/lag the spread via cross-correlation."""
    print("\n" + "=" * 60)
    print("LEAD-LAG ANALYSIS (cross-correlation)")
    print("=" * 60)

    features = ['kalshi_ba_spread', 'poly_ba_spread', 'mid_divergence', 'kalshi_mid', 'poly_mid']
    target = 'spread_cents'
    max_lag = 10
    results = []

    for pair_id in tier1_ids:
        pdf = df_feat[df_feat['pair_id'] == pair_id].sort_values('timestamp')
        y = pdf[target].values.astype(float)
        if np.std(y) < 1e-10 or len(y) < 30:
            continue

        for feature in features:
            x = pdf[feature].values.astype(float)
            if np.std(x) < 1e-10:
                continue

            # Normalize
            x_norm = (x - np.mean(x)) / (np.std(x) + 1e-10)
            y_norm = (y - np.mean(y)) / (np.std(y) + 1e-10)

            best_lag, best_corr = 0, 0
            for lag in range(-max_lag, max_lag + 1):
                if lag > 0:
                    c = np.corrcoef(x_norm[:-lag], y_norm[lag:])[0, 1]
                elif lag < 0:
                    c = np.corrcoef(x_norm[-lag:], y_norm[:lag])[0, 1]
                else:
                    c = np.corrcoef(x_norm, y_norm)[0, 1]

                if abs(c) > abs(best_corr):
                    best_lag, best_corr = lag, c

            results.append({
                'pair_id': pair_id[:12],
                'feature': feature,
                'best_lag': best_lag,
                'best_corr': round(best_corr, 4),
                'interpretation': (
                    f"feature LEADS spread by {best_lag}" if best_lag > 0
                    else f"feature LAGS spread by {-best_lag}" if best_lag < 0
                    else "contemporaneous"
                ),
            })

    df_ll = pd.DataFrame(results)
    if len(df_ll) > 0:
        summary = df_ll.groupby('feature').agg({
            'best_lag': 'mean',
            'best_corr': 'mean',
        }).sort_values('best_lag', ascending=False)
        print("\n--- Lead-Lag Summary ---")
        print("  (positive lag = feature LEADS spread)")
        print(summary.round(3).to_string())

    return df_ll


# ============================================================
# 9. UNIFIED SYNTHESIS
# ============================================================

def synthesize_all(granger_df, te_df, nl_df, regime_results, pc_graph, ll_df):
    """Combine all causal evidence into final ranking with confidence."""
    print("\n" + "=" * 60)
    print("UNIFIED CAUSAL SYNTHESIS")
    print("=" * 60)

    evidence = {}

    # Granger
    if len(granger_df) > 0:
        for feat in granger_df['feature'].unique():
            fd = granger_df[granger_df['feature'] == feat]
            causes = (fd['direction'] == 'CAUSES_SPREAD').sum()
            evidence.setdefault(feat, {})
            evidence[feat]['granger_pct'] = causes / max(len(fd), 1)
            evidence[feat]['granger_f'] = fd[fd['direction'] == 'CAUSES_SPREAD']['f_forward'].mean() if causes else 0

    # Transfer entropy
    if len(te_df) > 0:
        for feat in te_df['feature'].unique():
            fd = te_df[te_df['feature'] == feat]
            evidence.setdefault(feat, {})
            evidence[feat]['te_net'] = fd['net_te'].mean()
            evidence[feat]['te_sig_pct'] = fd['significant'].mean()
            evidence[feat]['te_z'] = fd['te_z_forward'].mean()

    # Nonlinear
    if len(nl_df) > 0:
        for feat in nl_df['feature'].unique():
            fd = nl_df[nl_df['feature'] == feat]
            evidence.setdefault(feat, {})
            evidence[feat]['mi_net'] = fd['mi_net'].mean()
            evidence[feat]['hsic_causes_pct'] = (fd['hsic_direction'] == 'CAUSES').mean()

    # Regime
    for feat, vals in regime_results.items():
        evidence.setdefault(feat, {})
        evidence[feat]['regime_significant'] = vals.get('significant', False)
        evidence[feat]['regime_effect'] = vals.get('effect', 0)

    # PC
    for edge in pc_graph:
        f = edge['from'].replace('_mean', '')
        t = edge['to'].replace('_mean', '')
        if t == 'spread_cents' and edge['directed']:
            evidence.setdefault(f, {})
            evidence[f]['pc_direct'] = True

    # Lead-lag
    if len(ll_df) > 0:
        for feat in ll_df['feature'].unique():
            fd = ll_df[ll_df['feature'] == feat]
            evidence.setdefault(feat, {})
            evidence[feat]['avg_lead'] = fd['best_lag'].mean()

    # Score
    rankings = []
    for feat, ev in evidence.items():
        score = 0
        n_methods = 0

        # Granger (0-25)
        if 'granger_pct' in ev:
            score += ev['granger_pct'] * 15 + min(ev.get('granger_f', 0) / 20, 1) * 10
            n_methods += 1

        # TE (0-25)
        if 'te_net' in ev:
            score += max(ev['te_net'] * 50, 0) * 0.5
            score += ev.get('te_sig_pct', 0) * 15
            n_methods += 1

        # Nonlinear (0-20)
        if 'mi_net' in ev:
            score += max(ev['mi_net'] * 30, 0)
            score += ev.get('hsic_causes_pct', 0) * 10
            n_methods += 1

        # Regime (0-15)
        if 'regime_significant' in ev:
            score += 10 if ev['regime_significant'] else 0
            score += min(abs(ev.get('regime_effect', 0)) * 2, 5)
            n_methods += 1

        # PC (0-10)
        if ev.get('pc_direct'):
            score += 10
            n_methods += 1

        # Lead-lag bonus (0-5)
        if ev.get('avg_lead', 0) > 0:
            score += min(ev['avg_lead'] * 2, 5)
            n_methods += 1

        # Confidence = how many methods agree
        confidence = n_methods / 6.0

        rankings.append({
            'feature': feat,
            'causal_score': round(score, 2),
            'confidence': round(confidence, 2),
            'n_methods': n_methods,
            **{k: round(v, 4) if isinstance(v, float) else v for k, v in ev.items()}
        })

    df_rank = pd.DataFrame(rankings).sort_values('causal_score', ascending=False)

    print("\n╔══════════════════════════════════════════════════════════════╗")
    print("║            FINAL CAUSAL RANKING (Refined)                  ║")
    print("╠══════════════════════════════════════════════════════════════╣")
    for _, row in df_rank.iterrows():
        bar_len = int(min(row['causal_score'], 50))
        bar = "█" * bar_len + "░" * (50 - bar_len)
        conf_stars = "★" * row['n_methods'] + "☆" * (6 - row['n_methods'])
        print(f"║  {row['feature']:22s} {bar} {row['causal_score']:5.1f}  ║")
        print(f"║  {'':22s} confidence: {conf_stars}  ({row['n_methods']}/6 methods)   ║")
    print("╚══════════════════════════════════════════════════════════════╝")

    # Save
    report = {
        'version': 'v2_refined',
        'data_quality': {
            'note': '94.6% of snapshots have spread=0 (sparse signal)',
            'approach': 'tier-based pair selection + regime analysis',
        },
        'rankings': df_rank.to_dict(orient='records'),
        'pc_graph': pc_graph,
        'regime_analysis': regime_results,
        'methods': [
            'granger_causality', 'transfer_entropy_permutation',
            'mutual_information', 'HSIC_kernel', 'regime_transitions',
            'PC_algorithm', 'lagged_cross_correlation',
        ],
        'interpretation': {
            'top_causes': df_rank.head(3)['feature'].tolist(),
            'confidence_note': 'n_methods indicates how many independent methods found causal evidence',
        }
    }

    path = OUTPUT_DIR / "causal_report_v2.json"
    with open(path, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nReport saved to {path}")

    return df_rank


# ============================================================
# MAIN
# ============================================================

def main():
    print("Phase 1 (Refined): Causal Discovery for Prediction Market Arbitrage")
    print("=" * 60)

    # 1. Load + assess
    df_snap, df_arb, tier1, tier2 = load_and_assess()
    tier1_ids = tier1.index.tolist()
    tier2_ids = tier2.index.tolist()

    # 2. Engineer temporal features for usable pairs
    all_pair_ids = tier1_ids + tier2_ids[:15]
    df_feat = engineer_temporal_features(df_snap, all_pair_ids)

    if len(df_feat) == 0:
        print("\nERROR: No usable pairs found. Need more data collection.")
        return

    # 3. Granger (tier 1 only — needs variance)
    granger_df = run_granger_analysis(df_feat, tier1_ids)

    # 4. Nonlinear causality (tier 1 + tier 2)
    nl_df = run_nonlinear_analysis(df_feat, tier1_ids, tier2_ids)

    # 5. Transfer entropy with significance
    te_df = run_te_analysis(df_feat, tier1_ids, tier2_ids)

    # 6. Regime transition analysis
    regime_results = run_regime_analysis(df_feat, tier1_ids, tier2_ids)

    # 7. Lead-lag
    ll_df = run_lead_lag_analysis(df_feat, tier1_ids)

    # 8. PC algorithm (use df_feat which has derived columns)
    pc_vars = [
        'kalshi_ba_spread', 'poly_ba_spread', 'mid_divergence',
        'kalshi_mid', 'poly_mid', 'spread_cents',
        'match_confidence', 'open_interest',
    ]
    agg = df_feat.groupby('pair_id')[pc_vars].agg(['mean', 'std']).dropna()
    agg.columns = [f"{c[0]}_{c[1]}" for c in agg.columns]
    pc_cols = [c for c in agg.columns if c.endswith('_mean')]
    pc_clean = agg[pc_cols].dropna()

    if len(pc_clean) >= 10:
        pc_graph, _, _ = pc_algorithm(pc_clean, pc_cols, alpha=0.05)
        for e in pc_graph:
            e['from'] = e['from'].replace('_mean', '')
            e['to'] = e['to'].replace('_mean', '')
    else:
        pc_graph = []

    # 9. Synthesize
    final = synthesize_all(granger_df, te_df, nl_df, regime_results, pc_graph, ll_df)

    print("\n" + "=" * 60)
    print("DONE. Refined causal report: analysis/output/causal_report_v2.json")
    print("=" * 60)

    return final


if __name__ == '__main__':
    main()
