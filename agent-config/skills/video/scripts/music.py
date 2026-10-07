#!/usr/bin/env python3
"""Backing-track tools for the video skill. Measures and edits; never plays audio.

  music.py screen FILE...                      pass/fail on hiss, clipping and ending, one row per file
  music.py fit SRC OUT.wav --len SECONDS       fit to the film's length and master (-16 LUFS, -2 dBTP before AAC)
             [--tempo BPM] [--lufs -16] [--tp -2] [--tail-max 40] [--min-body 15]

Run with: uv run --no-project --python 3.12 --with numpy --with scipy --with librosa --with soundfile \
  --with pyloudnorm python music.py ...   (also needs ffmpeg and rubberband on PATH)

Screen rule (acoustic and orchestral briefs; electronic briefs may exceed the HF limits): the 8-16 kHz energy per
0.1 s frame, relative to the 0.1-2 kHz body. Real recordings and clean models sit at -44 to -70 dB; the Stable Audio 3
Medium tracks that shipped on the family-firm films sat at -24 dB with 77% of frames within 30 dB (hiss and noise bursts).
"""
import json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf, scipy.signal as sg, pyloudnorm as pyln

SR = 48000
HF_MEDIAN_MAX_DB = -40.0   # median HF-vs-body must be at or below
HF_FRAMES_MAX_PCT = 25.0   # frames with HF within 30 dB of the body
OVERS_MAX = 100            # samples at or over 0 dBFS in the decoded source


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


def screen(paths):
    print(f"{'file':34} {'sec':>6} {'LUFS':>6} {'TPdB':>5} {'overs':>6} {'HFmed':>6} {'HF>-30%':>8} {'ending':>9}  verdict")
    bad = 0
    for p in paths:
        x = decode(p)
        lufs = pyln.Meter(SR).integrated_loudness(x.astype(np.float64))
        med, pct = hf_vs_body(x)
        overs = int((np.abs(x) >= 1.0).sum())
        why = [w for w, f in (("hiss", med > HF_MEDIAN_MAX_DB or pct > HF_FRAMES_MAX_PCT), ("clipped", overs > OVERS_MAX)) if f]
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


def splice(x, L, hint, min_body, tail_max):
    """Opening of the source + its own ending, joined at two beats whose harmony (chroma) and level match."""
    import librosa
    T, W = len(x) / SR, 2.0
    bt, y = beats(x, hint)
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
        if not 9.0 <= tail <= tail_max:
            continue
        for a in ok:
            dev = a + tail - L
            if a < min_body or a >= b - 1 or abs(dev) > 0.04 * L:
                continue
            cost = (1 - pre[a][0] @ pre[b][0]) + (1 - post[a][0] @ post[b][0]) + 0.03 * (abs(pre[a][1] - pre[b][1]) + abs(post[a][1] - post[b][1])) + 0.02 * abs(dev)
            if best is None or cost < best[0]:
                best = (cost, a, b)
    if best is None:
        return None
    cost, a, b = best
    d = min(int(np.median(np.diff(bt)) * SR), int(1.2 * SR))  # one-beat equal-power crossfade
    ia, ib = int(a * SR), int(b * SR)
    th = np.linspace(0, np.pi / 2, d)[:, None]
    out = np.concatenate([x[: ia - d], x[ia - d: ia] * np.cos(th) + x[ib - d: ib] * np.sin(th), x[ib:]])
    return out, {"body_end_s": round(float(a), 2), "ending_from_s": round(float(b), 2), "join_cost": round(float(cost), 3)}


def master(x, lufs, tp):
    x = sg.sosfilt(sg.butter(2, 30, "hp", fs=SR, output="sos"), x, axis=0).astype(np.float32)
    meter = pyln.Meter(SR)
    for _ in range(4):
        y = x * 10 ** ((lufs - meter.integrated_loudness(x.astype(np.float64))) / 20)
        a, b = tmp(), tmp()
        sf.write(a, y, SR, subtype="FLOAT")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", a, "-af",
                        f"alimiter=limit={10 ** (tp / 20):.5f}:attack=5:release=80:level=disabled:asc=1", "-c:a", "pcm_f32le", b], check=True)
        y, _ = sf.read(b, dtype="float32", always_2d=True)
        os.remove(a); os.remove(b)
        got = meter.integrated_loudness(y.astype(np.float64))
        if abs(got - lufs) < 0.25:
            break
        x = x * 10 ** ((lufs - got) / 20)
    return y, {"lufs": round(float(got), 2), "true_peak_dbtp": round(true_peak_db(y), 2)}


def fit(src, out, L, tempo, lufs, tp, tail_max, min_body):
    x = trim_silence(decode(src))
    T = len(x) / SR
    log = {"src": os.path.basename(src), "source_s": round(T, 1)}
    if 0.92 * L <= T <= 1.08 * L:
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
    x = x[: int(L * SR)]
    x = np.pad(x, ((0, int(L * SR) - len(x)), (0, 0)))
    natural = has_decay(x)
    fo, fi = int((0.4 if natural else 3.0) * SR), int(0.6 * SR)
    x[:fi] *= (np.sin(np.linspace(0, np.pi / 2, fi)) ** 2)[:, None]
    x[-fo:] *= (np.cos(np.linspace(0, np.pi / 2, fo)) ** 2)[:, None]
    log["natural_ending"] = bool(natural)
    y, m = master(x, lufs, tp)
    sf.write(out, y, SR, subtype="PCM_24")
    print(json.dumps({**log, **m}))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("screen"); s.add_argument("files", nargs="+")
    f = sub.add_parser("fit"); f.add_argument("src"); f.add_argument("out"); f.add_argument("--len", type=float, required=True)
    f.add_argument("--tempo", type=float, default=62.0); f.add_argument("--lufs", type=float, default=-16.0); f.add_argument("--tp", type=float, default=-2.0)
    f.add_argument("--tail-max", type=float, default=40.0); f.add_argument("--min-body", type=float, default=15.0)
    a = ap.parse_args()
    if a.cmd == "screen":
        sys.exit(screen(a.files))
    fit(a.src, a.out, a.len, a.tempo, a.lufs, a.tp, a.tail_max, a.min_body)
