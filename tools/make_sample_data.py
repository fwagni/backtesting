"""Generate synthetic Notion-style CSV exports for testing the dashboard.

Output mimics Notion's CSV quirks: relation URLs, "Month D, YYYY" dates,
"$75.00" money, "Yes/No" checkboxes, comma-joined multi-selects.
The data has deliberate edges (bias alignment, weekdays, news, grades) so
every dashboard page has something to show. It is NOT real market data.

Run:  python3 tools/make_sample_data.py
"""
import csv, random, datetime as dt, os

random.seed(7)
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'sample')
os.makedirs(OUT, exist_ok=True)

MODELS = {
    '10 AM Reversal': '4050b7e3553381cc85e3c1e93cf53d09',
    'Liquidity Sweep + MSS + FVG': '4050b7e3553381ecba3acf16a5a605bf',
    'London-to-NY Continuation': '4050b7e3553381be9639d142f4b78dfc',
}
ACC = ('Prop 50K Challenge', '4050b7e3553381579908dcfaa29e1e6f')


def rel(name, pid):
    slug = name.replace(' + ', '-').replace(' ', '-')
    return f"{name} (https://www.notion.so/{slug}-{pid}?pvs=21)"


def ndate(d):
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def money(x):
    return f"${x:,.2f}"


def hhmm(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def weekdays(a, b):
    d = a
    while d <= b:
        if d.weekday() < 5:
            yield d
        d += dt.timedelta(days=1)


COLS = ["Trade", "ID", "Mode", "Model", "Model version", "Account", "Day", "Instrument", "Date",
        "Day of week", "Entry time", "Exit time", "Session", "Kill zone", "Macro window", "Direction",
        "HTF bias", "Trade with bias", "Bias timeframe", "Setup timeframe", "Entry timeframe",
        "Daily profile", "Asia range", "Liquidity taken", "Confluences", "PD array of entry",
        "Premium/Discount", "News day", "Economic event", "Entry", "Stop", "Target", "Planned RR",
        "Result", "R multiple", "Risk ($)", "P&L ($)", "MAE (R)", "MFE (R)", "Exit reason", "Taken",
        "Followed plan", "Logged before outcome", "Setup grade", "Confidence (1-5)", "Emotion before",
        "Emotion during", "Emotion after", "Mistakes", "Screenshot before", "Screenshot after", "Notes"]

MACROS = [(530, 550), (590, 610), (650, 670), (710, 730), (790, 820), (915, 945)]


def make_trade(i, mode, d):
    model = random.choices(list(MODELS), [4, 4, 3])[0]
    inst = random.choices(['NQ', 'ES', 'MNQ', 'MES'], [5, 3, 2, 1])[0]
    if model == '10 AM Reversal':
        session, kz = 'NY AM', 'NY AM KZ'
        t = random.randint(9 * 60 + 48, 10 * 60 + 20)
        liq = random.sample(['London high', 'London low', 'PDH', 'PDL', 'Equal highs', 'Equal lows'],
                            k=random.choice([1, 1, 2]))
    elif model == 'London-to-NY Continuation':
        session, kz = 'NY AM', random.choice(['NY AM KZ', 'NY AM KZ', 'None'])
        t = random.randint(9 * 60 + 40, 11 * 60 + 15)
        liq = random.sample(['Asia high', 'Asia low'], 1) + (['London low'] if random.random() < .2 else [])
    else:
        session = random.choices(['London', 'NY AM', 'NY PM'], [3, 5, 2])[0]
        t = {'London': random.randint(120, 300), 'NY AM': random.randint(570, 690),
             'NY PM': random.randint(810, 940)}[session]
        kz = {'London': 'London KZ', 'NY AM': 'NY AM KZ', 'NY PM': 'NY PM KZ'}[session] \
            if random.random() > .15 else 'None'
        liq = random.sample(['Asia high', 'Asia low', 'London high', 'London low', 'PDH', 'PDL',
                             'Equal highs', 'Equal lows', 'Midnight open'], k=random.choice([1, 1, 2]))
    macro = 'None'
    for a, b in MACROS:
        if a <= t <= b:
            macro = f"{hhmm(a)}-{hhmm(b)}"

    direction = random.choice(['Long', 'Short'])
    bias = random.choices(['Bullish', 'Bearish', 'Neutral'], [4, 4, 1])[0]
    if random.random() < .25:
        bias = 'Bullish' if direction == 'Short' else 'Bearish'
    with_bias = (direction == 'Long' and bias == 'Bullish') or (direction == 'Short' and bias == 'Bearish')

    conf = ['MSS', 'FVG'] if model != 'London-to-NY Continuation' \
        else random.choice([['FVG'], ['Order block'], ['FVG', 'MSS']])
    for c, p in [('Displacement', .6), ('SMT divergence', .3), ('OTE', .3), ('iFVG', .15),
                 ('CISD', .2), ('Breaker', .1)]:
        if random.random() < p:
            conf.append(c)
    news = random.choices(['None', 'Medium', 'High (pre)', 'High (post)'], [12, 3, 2, 2])[0]
    grade = random.choices(['A+', 'A', 'B', 'C'], [2, 4, 3, 1])[0]
    followed = random.random() > (.06 if mode == 'Backtest' else .16)
    emo = random.choices(['Calm', 'Confident', 'Anxious', 'FOMO', 'Fear', 'Bored', 'Revenge'],
                         [8, 5, 3, 2, 2, 1, 1])[0] if mode == 'Paper' else ''
    asia = random.choices(['Small', 'Normal', 'Large'], [3, 5, 2])[0]

    p = .40
    p += .10 if with_bias else -.12
    p += {0: -.09, 1: .04, 2: .05, 3: .03, 4: -.04}[d.weekday()]
    p += {'None': 0, 'Medium': -.02, 'High (pre)': -.14, 'High (post)': .02}[news]
    p += {'A+': .09, 'A': .03, 'B': -.03, 'C': -.11}[grade]
    if 'SMT divergence' in conf: p += .05
    if 'Displacement' in conf: p += .06
    if kz == 'None': p -= .10
    if model == 'London-to-NY Continuation' and asia == 'Small': p += .08
    if model == '10 AM Reversal' and any(x.startswith('London') for x in liq): p += .06
    if model == 'Liquidity Sweep + MSS + FVG' and session == 'NY PM': p -= .08
    if not followed: p -= .10
    if emo in ('FOMO', 'Revenge', 'Fear'): p -= .12
    if mode == 'Paper': p -= .04
    p = max(.08, min(.8, p))

    rr = round(random.uniform(1.8, 3.4), 2)
    u = random.random()
    if u < .07:
        result, r, exitr = 'Breakeven', 0.0, 'Breakeven stop'
    elif u < .07 + p:
        result = 'Win'
        if random.random() < .8:
            r, exitr = rr, 'Target'
        else:
            r, exitr = round(random.uniform(.6, rr - .2), 2), random.choice(['Manual', 'Time exit'])
    else:
        result, r, exitr = 'Loss', -1.0, 'Stop'
    if result == 'Win':
        mae, mfe = round(random.uniform(.05, .9), 2), round(r + random.uniform(0, 1.2), 2)
    elif result == 'Loss':
        mae, mfe = 1.0, round(random.uniform(0, 1.8), 2)
    else:
        mae, mfe = round(random.uniform(.1, .8), 2), round(random.uniform(.8, 1.6), 2)

    base = random.uniform(15000, 21000) if 'NQ' in inst else random.uniform(4000, 6000)
    dist = random.uniform(15, 40) if 'NQ' in inst else random.uniform(4, 10)
    sgn = 1 if direction == 'Long' else -1
    entry = round(base * 4) / 4
    stop = round((entry - sgn * dist) * 4) / 4
    target = round((entry + sgn * dist * rr) * 4) / 4
    risk = 75.0
    return {
        "Trade": f"{inst} {model.split(' ')[0]} {direction.lower()}", "ID": f"TR-{i}", "Mode": mode,
        "Model": rel(model, MODELS[model]),
        "Model version": 'v1' if d.year < 2025 or mode == 'Paper' else random.choice(['v1', 'v2']),
        "Account": rel(*ACC), "Day": "", "Instrument": inst, "Date": ndate(d),
        "Day of week": d.strftime('%a'), "Entry time": hhmm(t),
        "Exit time": hhmm(min(t + random.randint(5, 90), 16 * 60)),
        "Session": session, "Kill zone": kz, "Macro window": macro, "Direction": direction,
        "HTF bias": bias, "Trade with bias": 'Yes' if with_bias else 'No',
        "Bias timeframe": random.choice(['Daily', 'Daily', 'Weekly', 'H4']),
        "Setup timeframe": random.choice(['M15', 'H1']),
        "Entry timeframe": random.choices(['M1', 'M3', 'M5', 'M15'], [3, 3, 4, 1])[0],
        "Daily profile": random.choice(['Classic buy day', 'Classic sell day', 'Reversal',
                                        'Consolidation', 'Expansion']),
        "Asia range": asia, "Liquidity taken": ', '.join(liq), "Confluences": ', '.join(conf),
        "PD array of entry": random.choice(['FVG', 'FVG', 'iFVG', 'Order block', 'OTE']),
        "Premium/Discount": 'Discount' if direction == 'Long' else 'Premium',
        "News day": news, "Economic event": "", "Entry": entry, "Stop": stop, "Target": target,
        "Planned RR": rr, "Result": result, "R multiple": r, "Risk ($)": money(risk),
        "P&L ($)": round(r * risk, 2), "MAE (R)": mae, "MFE (R)": mfe, "Exit reason": exitr,
        "Taken": 'Taken', "Followed plan": 'Yes' if followed else 'No',
        "Logged before outcome": 'Yes' if mode == 'Paper' or random.random() < .6 else 'No',
        "Setup grade": grade, "Confidence (1-5)": str(min(5, max(1, round(p * 8)))),
        "Emotion before": emo, "Emotion during": emo, "Emotion after": '', "Mistakes": "",
        "Screenshot before": "", "Screenshot after": "", "Notes": "",
    }


rows, i = [], 1
for d in weekdays(dt.date(2023, 1, 2), dt.date(2025, 12, 31)):
    if random.random() < .55:
        rows.append(make_trade(i, 'Backtest', d)); i += 1
for d in weekdays(dt.date(2026, 8, 3), dt.date(2026, 10, 23)):
    if random.random() < .85:
        rows.append(make_trade(i, 'Paper', d)); i += 1

with open(os.path.join(OUT, 'trades.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=COLS)
    w.writeheader()
    w.writerows(rows)

with open(os.path.join(OUT, 'accounts.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f)
    w.writerow(["Name", "Type", "Account size", "Risk per trade", "Risk %", "Profit target",
                "Daily loss limit", "Max drawdown", "Drawdown type", "Min trading days", "Room in R",
                "Active", "Notes", "Trades"])
    w.writerow([ACC[0], "Prop challenge", money(50000), money(75), "0.15", money(3000), "",
                money(2000), "", "", "26.7", "Yes", "", ""])

print(len(rows), 'trades written to', os.path.abspath(OUT))
