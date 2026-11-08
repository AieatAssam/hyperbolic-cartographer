#!/usr/bin/env python3
"""Rebuilds public/audio/ from the sources listed in src/audio/assets.json.

Needs python3 and ffmpeg (with libopus). Not run in CI: the encoded files are committed.

  python3 scripts/audio/build-audio.py            # download (cached), encode, print sizes
  python3 scripts/audio/build-audio.py --analyse  # also print integrated loudness per track
  python3 scripts/audio/build-audio.py --sfx      # rebuild only the sound effects
  python3 scripts/audio/build-audio.py --credits  # only regenerate AUDIO-CREDITS.md

Music: loudness-matched to MUSIC_LUFS, optionally shortened to maxSec with a fade-out,
then WebM/Opus (stereo) plus an AAC .m4a fallback (mono) for browsers without Opus.
SFX: leading silence trimmed, cut to len seconds with a fade, peak-normalised, mono.
"""
import io, json, os, subprocess, sys, urllib.parse, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = json.load(open(os.path.join(ROOT, 'src', 'audio', 'assets.json')))
OUT = os.path.join(ROOT, 'public', 'audio')
CACHE = os.environ.get('AUDIO_CACHE', os.path.expanduser('~/.cache/hc-audio'))
UA = {'User-Agent': 'Mozilla/5.0 (hyperbolic-cartographer audio build)'}

MUSIC_LUFS = -20.0
MUSIC_OPUS = ['-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', '-application', 'audio', '-ac', '2', '-ar', '48000']
MUSIC_AAC = ['-c:a', 'aac', '-b:a', '40k', '-ac', '1', '-ar', '32000', '-movflags', '+faststart']
SFX_OPUS = ['-c:a', 'libopus', '-b:a', '48k', '-vbr', 'on', '-ac', '1', '-ar', '48000']
SFX_AAC = ['-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '44100', '-movflags', '+faststart']
FADE_OUT = 8.0


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, urllib.parse.unquote(url.split('/')[-1]).replace(' ', '_'))
    if not os.path.exists(path):
        print('  download', url)
        data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180).read()
        open(path, 'wb').write(data)
    return path


def from_zip(zpath, member):
    out = os.path.join(CACHE, os.path.basename(member))
    if not os.path.exists(out):
        with zipfile.ZipFile(zpath) as z:
            name = next(n for n in z.namelist() if n.endswith(member))
            open(out, 'wb').write(z.read(name))
    return out


def ff(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def probe_duration(path):
    r = subprocess.run(['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True)
    return float(r.stdout)


def lufs(path):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(err[err.rfind('I:') + 2:].split('LUFS')[0])


def peak_db(path, af):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', af + ',volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(err.split('max_volume:')[1].split('dB')[0])


def build_music(t):
    src = fetch(t['url'])
    if t.get('zipMember'):
        src = from_zip(src, t['zipMember'])
    dur = probe_duration(src)
    gain = MUSIC_LUFS - lufs(src)
    chain = ['afade=t=in:d=0.4']
    if t.get('maxSec') and dur > t['maxSec'] + 1:
        cut = t['maxSec']
        chain = [f'atrim=0:{cut}'] + chain + [f'afade=t=out:st={cut - FADE_OUT}:d={FADE_OUT}']
    chain += [f'volume={gain:.2f}dB', 'alimiter=limit=0.89:level=false']
    af = ','.join(chain)
    base = os.path.join(OUT, 'music', t['id'])
    ff('-i', src, '-af', af, '-vn', *MUSIC_OPUS, '-f', 'webm', base + '.webm')
    ff('-i', src, '-af', af, '-vn', *MUSIC_AAC, base + '.m4a')
    return base


def sfx_source(s):
    pack = ASSETS['packs'][s['pack']]
    if 'zip' in pack:
        z = fetch(pack['zip'])
        return from_zip(z, s['path'])
    return fetch(pack['base'] + urllib.parse.quote(s['path']))


def build_sfx(s):
    src = sfx_source(s)
    n = s['len']
    fin = s.get('fadeIn', 0.004)
    fo = max(0.05, n * 0.45)
    # normalise before trimming so quiet raw takes keep their onset; then re-normalise the trimmed cut
    raw = f'volume={-3.0 - peak_db(src, "anull"):.2f}dB'
    cut = f"{raw},silenceremove=start_periods=1:start_threshold=-48dB,atrim=0:{n},afade=t=in:d={fin},afade=t=out:st={n - fo}:d={fo}"
    af = f'{cut},volume={-3.0 - peak_db(src, cut):.2f}dB'
    base = os.path.join(OUT, 'sfx', s['id'])
    ff('-i', src, '-af', af, '-vn', *SFX_OPUS, '-f', 'webm', base + '.webm')
    ff('-i', src, '-af', af, '-vn', *SFX_AAC, base + '.m4a')
    return base


def size(base):
    return sum(os.path.getsize(base + e) for e in ('.webm', '.m4a'))


STAGE_LABEL = {
    'survey': 'Survey', 'drift': 'Drift', 'projection': 'Projection', 'torus': 'Manifold (torus)',
    'klein': 'Manifold (Klein bottle)', 'dimension': 'Dimension', 'horizon': 'Horizon',
}


def write_credits():
    lic = ASSETS['licences']
    L = lambda k: f"[{lic[k]['name']}]({lic[k]['url']})"
    out = [
        '# Audio credits',
        '',
        'Every music track and sound effect in `public/audio/` is by another artist and licensed CC0 or CC BY.',
        'None are NC, ND or SA. Tracks marked "shortened" were cut to the listed length with an 8-second fade-out;',
        'every file was re-encoded (WebM/Opus, with an AAC .m4a fallback) and loudness-matched.',
        'Kevin MacLeod tracks: "Title" Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0.',
        '',
        'Generated from `src/audio/assets.json` by `python3 scripts/audio/build-audio.py --credits`.',
        '',
        '## Music',
        '',
    ]
    for stage, label in STAGE_LABEL.items():
        out += [f'### {label}', '', '| Title | Author | Source | Licence | Changes |', '|---|---|---|---|---|']
        for t in (t for t in ASSETS['music'] if t['stage'] == stage):
            ch = f"shortened to {t['maxSec']} s, re-encoded" if t.get('maxSec') else 're-encoded'
            out.append(f"| {t['title']} | {t['author']} | {t['page']} | {L(t['licence'])} | {ch} |")
        out.append('')
    out += ['## Sound effects', '']
    for pid, p in ASSETS['packs'].items():
        out += [f"### {p['title']}", '', f"By {p['author']}. Source: {p['page']}. Licence: {L(p['licence'])}.", '',
                '| File in game | Original sample | Used for |', '|---|---|---|']
        for s in (s for s in ASSETS['sfx'] if s['pack'] == pid):
            out.append(f"| `sfx/{s['id']}` | {s['title']} (`{s['path']}`) | {s['use'][0].upper() + s['use'][1:]} |")
        out.append('')
    out += [
        '## Licence texts',
        '',
        *[f"- {v['name']}: {v['url']}" for v in lic.values()],
        '',
    ]
    open(os.path.join(ROOT, 'AUDIO-CREDITS.md'), 'w').write('\n'.join(out))


def main():
    if '--credits' in sys.argv:
        return write_credits()
    os.makedirs(os.path.join(OUT, 'music'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'sfx'), exist_ok=True)
    totals = {'music': [0, 0], 'sfx': [0, 0]}
    only_sfx = '--sfx' in sys.argv
    for t in [] if only_sfx else ASSETS['music']:
        b = build_music(t)
        w, m = os.path.getsize(b + '.webm'), os.path.getsize(b + '.m4a')
        totals['music'][0] += w
        totals['music'][1] += m
        line = f"{t['id']:34s} {probe_duration(b + '.webm'):6.1f}s  webm {w / 1024:6.0f} KB  m4a {m / 1024:6.0f} KB"
        if '--analyse' in sys.argv:
            line += f"  {lufs(b + '.webm'):.1f} LUFS"
        print(line)
    for s in ASSETS['sfx']:
        b = build_sfx(s)
        w, m = os.path.getsize(b + '.webm'), os.path.getsize(b + '.m4a')
        totals['sfx'][0] += w
        totals['sfx'][1] += m
        print(f"{s['id']:34s} webm {w / 1024:5.1f} KB  m4a {m / 1024:5.1f} KB")
    for k, (w, m) in totals.items():
        print(f'{k}: webm {w / 1048576:.2f} MB, m4a {m / 1048576:.2f} MB')
    print(f"total: {sum(w + m for w, m in totals.values()) / 1048576:.2f} MB")
    write_credits()


if __name__ == '__main__':
    main()
