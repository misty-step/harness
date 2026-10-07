#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "scipy", "librosa", "soundfile", "pyloudnorm"]
# ///
"""Backing-track tools for the video skill. Measures and edits; never plays audio.

  music.py screen [--beat] FILE...             pass/fail on hiss, clipping and ending, one row per file
  music.py fit SRC OUT.wav --len SECONDS       fit to the film's length and master (-16 LUFS, -2 dBTP before AAC)
             [--cuts T1,T2,... [--lead 0.55]] [--tempo BPM] [--lufs -16] [--tp -2] [--tail-max 40] [--min-body 15]

Needs uv (installs the Python dependencies above on first run), ffmpeg and rubberband on PATH.

Screen rule: the 8-16 kHz energy per 0.1 s frame relative to the 0.1-2 kHz body. Real recordings and clean models sit at
-44 to -70 dB; the Stable Audio 3 Medium tracks that shipped on the family-firm films sat at -24 dB with 77% of frames
within 30 dB (hiss and noise bursts). Music with hats, shakers and claps legitimately has more: --beat allows -30 dB and 60%
(clean Lyria and Stable Audio 2.5 beds measured -34 to -75 dB and 0-41%; noisy takes -8 to -27 dB and 55-99%).
"""
import json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf, scipy.signal as sg, pyloudnorm as pyln

SR = 48000
HF_LIMITS = {"quiet": (-40.0, 25.0), "beat": (-30.0, 60.0)}  # (median dB, % of frames within 30 dB of the body)
OVERS_MAX_FRAC = 1e-3      # share of decoded samples at or over 0 dBFS (limited MP3s overshoot a little; real clipping is far more)


def tmp(suffix=".wav"):
    return tempfile.mktemp(suffix=suffix, dir=os.environ.get("TMPDIR", "/tmp"))


def decode(path, sr=SR):
    t = tmp()
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-ar", str(sr), "-ac", "2", "-c:a", "pcm_f32le", t], check=True)
    x, _ = sf.read(t, dtype="float32", always_2d=True)
    os.remove(t)
    return x


def true_peak_db(x):
    return float(20 * np.log10(np.abs(sg.resample_poly(x, 4, 1, axis=0)).max() + 1e-12))


def hf_vs_body(x):
    import librosa
    S = np.abs(librosa.stft(x.mean(1).astype(np.float64), n_fft=4096, hop_length=SR // 10)) ** 2
    f = librosa.fft_frequencies(sr=SR, n_fft=4096)
    body = S[(f >= 100) & (f < 2000)].sum(0) + 1e-14
    hf = S[(f >= 8000) & (f < 16000)].sum(0) + 1e-14
    rel = (10 * np.log10(hf / body))[body > body.max() * 1e-4]
    return float(np.median(rel)), float(100 * (rel > -30).mean())


def has_decay(x, db=-10.0):
    y = x.mean(1)
    body = np.sqrt((y[: int(len(y) * 0.9)] ** 2).mean())
    return 20 * np.log10(np.sqrt((y[-3 * SR:] ** 2).mean()) / body + 1e-9) < db


def verdict(x, beat=False):
    med, pct = hf_vs_body(x)
    overs = int((np.abs(x) >= 1.0).sum())
    lim = HF_LIMITS["beat" if beat else "quiet"]
    why = [w for w, f in (("hiss", med > lim[0] or pct > lim[1]), ("clipped", overs > OVERS_MAX_FRAC * x.size)) if f]
    return why, med, pct, overs


def screen(paths, beat=False):
    print(f"{'file':34} {'sec':>6} {'LUFS':>6} {'TPdB':>5} {'overs':>6} {'HFmed':>6} {'HF>-30%':>8} {'ending':>9}  verdict")
    bad = 0
    for p in paths:
        x = decode(p)
        lufs = pyln.Meter(SR).integrated_loudness(x.astype(np.float64))
        why, med, pct, overs = verdict(x, beat)
        bad += bool(why)
        print(f"{os.path.basename(p)[:34]:34} {len(x)/SR:6.1f} {lufs:6.1f} {true_peak_db(x):5.1f} {overs:6d} {med:6.1f} {pct:8.1f} {'natural' if has_decay(x) else 'none':>9}  {'REJECT ' + ','.join(why) if why else 'ok'}")
    return 1 if bad else 0


# ---- fit and master ----

def stretch(x, ratio):
    a, b = tmp(), tmp()
    sf.write(a, x, SR, subtype="FLOAT")
    subprocess.run(["rubberband", "-3", "-q", "-t", f"{ratio:.6f}", a, b], check=True, stderr=subprocess.DEVNULL)
    y, _ = sf.read(b, dtype="float32", always_2d=True)
    os.remove(a); os.remove(b)
    return y


def trim_silence(x):
    """Drop leading digital silence and trailing near-silence so the natural decay ends the film, not dead air."""
    m = x.mean(1)
    h = SR // 50
    n = len(m) // h
    e = 20 * np.log10(np.sqrt((m[: n * h].reshape(n, h) ** 2).mean(1)) + 1e-9)
    lead = np.where(e > -60)[0]
    s = max(0, (lead[0] if len(lead) else 0) * h - SR // 20)
    ref = np.median(e[e > e.max() - 40])
    tail = np.where(e > ref - 48)[0]
    end = min(len(m), (tail[-1] + 1) * h + SR // 4) if len(tail) else len(m)
    return x[s:end]


def beats(x, hint):
    import librosa
    y = librosa.resample(x.mean(1), orig_sr=SR, target_sr=22050)
    env = librosa.onset.onset_strength(y=y, sr=22050, hop_length=512)
    _, b = librosa.beat.beat_track(onset_envelope=env, sr=22050, hop_length=512, start_bpm=hint, tightness=100, trim=False)
    t = librosa.frames_to_time(b, sr=22050, hop_length=512)
    if len(t) > 4 and np.median(np.diff(t)) < 0.5:  # tracked a subdivision
        t = t[::2]
    return t, y


def splice(x, L, hint, min_body, tail_max, pts=None, tol=None, xfade=None, tail_min=9.0):
    """Opening of the source + its own ending, joined at two points (beats, or the given bar lines) whose harmony
    (chroma) and level match. Returns the joined audio, or None when no pair lands within tol seconds of L."""
    import librosa
    T, W = len(x) / SR, 2.0
    if pts is None:
        bt, y = beats(x, hint)
        tol = 0.04 * L
    else:
        bt, y = np.asarray(pts), librosa.resample(x.mean(1), orig_sr=SR, target_sr=22050)
    ok = [t for t in bt if W + 0.5 < t < T - W]
    seg = lambda a, b: y[int(max(a, 0) * 22050): int(b * 22050)]
    def chroma(a, b):
        v = librosa.feature.chroma_cqt(y=seg(a, b), sr=22050, hop_length=1024).mean(1)
        return v / (np.linalg.norm(v) + 1e-9)
    db = lambda a, b: 20 * np.log10(np.sqrt((seg(a, b) ** 2).mean()) + 1e-9)
    pre = {t: (chroma(t - W, t), db(t - W, t)) for t in ok}
    post = {t: (chroma(t, t + W), db(t, t + W)) for t in ok}
    best = None
    for b in ok:
        tail = T - b
        if not tail_min <= tail <= tail_max:
            continue
        for a in ok:
            dev = a + tail - L
            if a < min_body or a >= b - 1 or abs(dev) > tol:
                continue
            cost = (1 - pre[a][0] @ pre[b][0]) + (1 - post[a][0] @ post[b][0]) + 0.03 * (abs(pre[a][1] - pre[b][1]) + abs(post[a][1] - post[b][1])) + 0.02 * abs(dev)
            if best is None or cost < best[0]:
                best = (cost, a, b)
    if best is None:
        return None
    cost, a, b = best
    d = xfade or min(int(np.median(np.diff(bt)) * SR), int(1.2 * SR))  # default: one beat, equal power
    ia, ib = int(a * SR), int(b * SR)
    th = np.linspace(0, np.pi / 2, d)[:, None]
    out = np.concatenate([x[: ia - d], x[ia - d: ia] * np.cos(th) + x[ib - d: ib] * np.sin(th), x[ib:]])
    return out, {"body_end_s": round(float(a), 2), "ending_from_s": round(float(b), 2), "join_cost": round(float(cost), 3)}


def fold(env, dt, bpm, n=24, t_off=0.0):
    """Mean onset strength by phase when the envelope is folded at bpm; a steady track at that tempo peaks sharply."""
    P = 60 / bpm
    b = np.minimum(((((np.arange(len(env)) * dt + t_off) % P) / P) * n).astype(int), n - 1)
    m = np.bincount(b, weights=env, minlength=n) / np.maximum(np.bincount(b, minlength=n), 1)
    return m, P


def measure_grid(env, dt, lo=80.0, hi=140.0):
    """Best constant tempo in [lo, hi] BPM for an onset envelope: (bpm, beat phase in seconds)."""
    coarse = np.arange(lo, hi, 0.1)
    sharp = lambda b: (lambda m: m.max() / (m.mean() + 1e-9))(fold(env, dt, b)[0])
    b0 = coarse[int(np.argmax([sharp(b) for b in coarse]))]
    fine = np.arange(b0 - 0.15, b0 + 0.15, 0.01)
    bpm = fine[int(np.argmax([sharp(b) for b in fine]))]
    m, P = fold(env, dt, bpm, 48)
    return float(bpm), float((np.argmax(m) + 0.5) / 48 * P)


def grid_lock(x, cuts, lead, n_beats=None):
    """Choose the tempo from the film's cut spacing S (BPM = 60 n / S for n whole beats between cuts; any take between
    80 and 140 BPM is within about 4% of one), stretch the take to it, find which beat is the downbeat, and start it so
    bar lines fall at (anchor cut + lead) plus whole bars and the beat enters on the bar nearest the first cut.
    Returns audio, downbeat times in film seconds, and what was measured."""
    import librosa
    cuts = sorted(cuts)
    gaps = np.diff(cuts)
    S = float(np.median(gaps))
    anchor = next(c for c, g in zip(cuts, gaps) if abs(g - S) < 0.3)
    y = librosa.resample(x.mean(1), orig_sr=SR, target_sr=22050)
    hop, dt = 128, 128 / 22050
    env = librosa.onset.onset_strength(y=y, sr=22050, hop_length=hop)
    src, _ = measure_grid(env, dt)
    n = n_beats or int(min(range(8, 40), key=lambda k: abs(60 * k / S - src)))
    bpm = 60 * n / S
    ratio = src / bpm
    if abs(ratio - 1) > 0.06:
        raise SystemExit(f"tempo {src:.1f} BPM is {abs(ratio - 1) * 100:.0f}% from the nearest cut-grid tempo {bpm:.1f}; pick another take")
    x = stretch(x, ratio) if abs(ratio - 1) > 0.002 else x
    y = librosa.resample(x.mean(1), orig_sr=SR, target_sr=22050)
    env = librosa.onset.onset_strength(y=y, sr=22050, hop_length=hop)
    low = librosa.onset.onset_strength(y=sg.sosfilt(sg.butter(4, 200, "lp", fs=22050, output="sos"), y), sr=22050, hop_length=hop)  # kick and bass onsets
    env = env / (env.max() + 1e-9) + low / (low.max() + 1e-9)
    P = 60 / bpm
    half = len(env) // 2
    ph = [measure_phase(env[a:b], dt, bpm, a * dt) for a, b in ((0, half), (half, len(env)))]
    drift = abs(((ph[1] - ph[0] + P / 2) % P) - P / 2)
    if drift > 0.06:
        raise SystemExit(f"tempo drifts {drift * 1000:.0f} ms between the two halves; pick another take")
    phi = measure_phase(env, dt, bpm, 0.0)
    lowm, _ = fold(low[half:], dt, bpm, 48, half * dt)  # the groove half; a steady track also peaks half a beat away (eighth notes)
    near = lambda p: float(np.mean([lowm[(int((p % P) / P * 48) + k) % 48] for k in range(-2, 3)]))
    if near(phi + P / 2) > 1.25 * near(phi):  # the kick and bass sit on the beat
        phi = (phi + P / 2) % P
    pk = int(np.argmax(lowm))
    unsure = float(np.mean([lowm[(pk + 24 + k) % 48] for k in range(-2, 3)]) / np.mean([lowm[(pk + k) % 48] for k in range(-2, 3)]))
    if unsure > 0.95:
        raise SystemExit(f"beat is ambiguous (kick and bass fall as strongly half a beat away: {unsure:.2f}); pick another take")
    grid = np.arange(phi, len(x) / SR - P, P)
    at = lambda t: env[min(int(t / dt), len(env) - 1)]
    m = int(np.argmax([sum(at(g) for g in grid[k::4]) for k in range(4)]))  # beat one carries the most onset energy
    down = grid[m::4]
    bar, lowb = 4 * P, sg.sosfilt(sg.butter(4, [40, 150], "bp", fs=22050, output="sos"), y)
    rms = np.array([20 * np.log10(np.sqrt((lowb[int(a * 22050): int(b * 22050)] ** 2).mean()) + 1e-9) for a, b in zip(down[:16], down[1:17])])
    j_e = int(np.argmax(rms >= (np.median(rms[8:]) if len(rms) > 8 else rms.max()) - 6))  # first bar where the bass and kick are in
    t0 = (anchor + lead) % bar
    n_last = round((anchor + lead - t0) / bar)  # the bar of the first regular cut: the groove should be in by then
    n_e = min(j_e, n_last)
    s = down[0] - t0 + (j_e - n_e) * bar  # source second that becomes film second 0 (negative: silence first)
    x = x[int(s * SR):] if s >= 0 else np.pad(x, ((int(-s * SR), 0), (0, 0)))
    dfilm = down - s
    on_bar = [round(1000 * float(((c + lead - t0 + bar / 2) % bar) - bar / 2)) for c in cuts]
    return x, dfilm[dfilm >= 0], {"src_bpm": round(src, 1), "grid_bpm": round(bpm, 1), "beats_per_cut": n, "tempo_change_pct": round((1 / ratio - 1) * 100, 1),
                                  "drift_ms": round(drift * 1000), "beat_clarity": round(1 - unsure, 2), "groove_enters_s": round(float(t0 + n_e * bar), 2), "cuts_off_bar_ms": on_bar}


def measure_phase(env, dt, bpm, t_off):
    """Beat phase in seconds (film time) of an envelope slice that starts t_off seconds in, at a known tempo."""
    m, P = fold(env, dt, bpm, 48, t_off)
    return float((np.argmax(m) + 0.5) / 48 * P)


def limit(y, ceiling_db):
    a, b = tmp(), tmp()
    sf.write(a, y, SR, subtype="FLOAT")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", a, "-af",
                    f"alimiter=limit={10 ** (max(ceiling_db, -24.0) / 20):.5f}:attack=5:release=80:level=disabled:asc=1", "-c:a", "pcm_f32le", b], check=True)
    y, _ = sf.read(b, dtype="float32", always_2d=True)
    os.remove(a); os.remove(b)
    return y


def aac_true_peak(y, kbps=192):
    a, b = tmp(), tmp(".m4a")
    sf.write(a, y, SR, subtype="FLOAT")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", a, "-c:a", "aac", "-b:a", f"{kbps}k", b], check=True)
    peak = true_peak_db(decode(b))
    os.remove(a); os.remove(b)
    return peak


def master(x, lufs, tp):
    """Gain to the target loudness, limit, and keep both the true peak and the AAC-encoded true peak in bounds."""
    x = sg.sosfilt(sg.butter(2, 30, "hp", fs=SR, output="sos"), x, axis=0).astype(np.float32)
    meter = pyln.Meter(SR)
    gain, ceil = lufs - meter.integrated_loudness(x.astype(np.float64)), tp
    for _ in range(10):
        y = limit(x * 10 ** (gain / 20), ceil)
        got, peak = meter.integrated_loudness(y.astype(np.float64)), true_peak_db(y)
        if peak > tp + 0.05:
            ceil -= peak - tp + 0.1  # the limiter works on samples; pull its ceiling down by the true-peak overshoot
        elif abs(got - lufs) > 0.25:
            gain += lufs - got
        else:
            break
    else:
        raise SystemExit(f"master: no gain and ceiling gave {lufs} LUFS within {tp} dBTP (last {got:.1f} LUFS, {peak:.1f} dBTP); pick another take")
    coded = aac_true_peak(y)
    if coded > -1.0:
        raise SystemExit(f"master: {coded:.1f} dBTP after AAC; lower --tp")
    return y, {"lufs": round(float(got), 2), "true_peak_dbtp": round(peak, 2), "aac_true_peak_dbtp": round(coded, 2)}


def fit(src, out, L, tempo, lufs, tp, tail_max, min_body, cuts=(), lead=0.55, n_beats=None):
    x = trim_silence(decode(src))
    T = len(x) / SR
    log = {"src": os.path.basename(src), "source_s": round(T, 1)}
    if cuts:  # tempo-locked: bar lines on the film's cut grid, the beat enters on the bar nearest the first cut, joins on bar lines
        x, down, info = grid_lock(x, cuts, lead, n_beats)
        log.update(info)
        T, beat = len(x) / SR, 60 / info["grid_bpm"]
        if T > L + 4 * beat:
            res = splice(x, L, tempo, min_body, tail_max, pts=down, tol=0.4, xfade=int(beat * SR), tail_min=4.0)
            if res is None:
                raise SystemExit(f"{src}: no bar-line join found; raise --tail-max or lower --min-body, or pick another take")
            x, info = res
            log.update(info)
        r = 1.0
    elif 0.92 * L <= T <= 1.08 * L:
        r = L / T
    elif T > 1.08 * L:
        res = splice(x, L, tempo, min_body, tail_max)
        if res is None:
            raise SystemExit(f"{src}: no join found; raise --tail-max or lower --min-body, or pick another take")
        x, info = res
        log.update(info)
        r = L / (len(x) / SR)
    else:
        raise SystemExit(f"{src}: {T:.1f} s is too short for {L} s")
    if abs(r - 1) > 0.002:
        x = stretch(x, r)
    log["stretch"] = round(r, 4)
    log["ends_s"] = round(min(len(x) / SR, L), 2)
    x = x[: int(L * SR)]
    x = np.pad(x, ((0, int(L * SR) - len(x)), (0, 0)))
    natural = has_decay(x)
    fo, fi = int((0.4 if natural else 3.0) * SR), int(0.6 * SR)
    fo, fi = min(fo, len(x) // 2), min(fi, len(x) // 2)
    x[:fi] *= (np.sin(np.linspace(0, np.pi / 2, fi)) ** 2)[:, None]
    x[len(x) - fo:] *= (np.cos(np.linspace(0, np.pi / 2, fo)) ** 2)[:, None]
    log["natural_ending"] = bool(natural)
    y, m = master(x, lufs, tp)
    sf.write(out, y, SR, subtype="PCM_24")
    print(json.dumps({**log, **m}))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("screen"); s.add_argument("--beat", action="store_true", help="music with drums and hats: allow more high-frequency energy"); s.add_argument("files", nargs="+")
    f = sub.add_parser("fit"); f.add_argument("src"); f.add_argument("out"); f.add_argument("--len", type=float, required=True)
    f.add_argument("--tempo", type=float, default=62.0); f.add_argument("--lufs", type=float, default=-16.0); f.add_argument("--tp", type=float, default=-2.0)
    f.add_argument("--tail-max", type=float, default=40.0); f.add_argument("--min-body", type=float, default=15.0)
    f.add_argument("--cuts", default="", help="comma-separated scene-change times; locks tempo and bar lines to them (BPM = 60 n / spacing)")
    f.add_argument("--lead", type=float, default=0.55, help="seconds from a cut's start to the bar line it should land on (half a crossfade)")
    f.add_argument("--beats-per-cut", type=int, help="force n beats between regular cuts instead of the nearest to the take's tempo")
    a = ap.parse_args()
    if a.cmd == "screen":
        sys.exit(screen(a.files, a.beat))
    fit(a.src, a.out, a.len, a.tempo, a.lufs, a.tp, a.tail_max, a.min_body, [float(c) for c in a.cuts.split(",") if c], a.lead, a.beats_per_cut)
