#!/usr/bin/env python3
"""Turn a phone photo of a document into a scan: find the page, flatten it, whiten the paper.

    scan_cleanup.py <in-image> <out.jpg>
    scan_cleanup.py --self-test

Prints one line of JSON: {"cleaned": bool, "outline": "page" | "partial" | "none", "folds": int,
"dpi": int, "width": int, "height": int} (spec §2 stage 1b).

- "page": all four corners were found; the page is flattened to its true proportions.
- "partial": the page runs off the photo's edge — the usual close-up. The table that shows is
  cropped away and the rest flattened, but its proportions are the photo's, not the paper's.
- "none": no outline, yet the photo is nearly all paper: shadows and colour cast are still removed.

A letter folded for an envelope does not lie flat: its panels sit at different angles, and its
side edges bend at each fold. Where the edges show a bend, the page is cut along the folds, each
panel flattened and whitened on its own, and the panels put back together. `folds` counts them.

When none of the outlines holds — a scrap of paper on a table — `cleaned` is false, nothing is
written and the caller keeps the photo as it is: evening out the light across a table as well as a
page turns the table into grey paper. `dpi` is what prints the page at its real size.

Runs inside the worker, which has no network and is the only process that opens documents. The
original upload is never touched; the output becomes the input to OCR and the searchable copy.
Works with OpenCV 4.6 and later.
"""
import json
import sys

import cv2
import numpy as np

DETECT_PX = 1000          # page detection runs on a copy this long on its longest side
MIN_AREA = 0.20           # a page smaller than this share of the photo is not trusted
PARTIAL_AREA = 0.50       # a page running out of frame is trusted only when it dominates it
PAPER_SHARE = 0.85        # with no outline at all, the photo is cleaned only if it is this much paper
FOLD_STRAIGHT = 0.002     # a side whose RMS distance from a straight line is under this share of its
                          #   length has no fold in it
FOLD_GAIN = 0.45          # a model with one more fold must bring the RMS error under this share
FOLD_AGREE = 0.08         # both sides must place a fold within this share of the page's height
FOLD_MIN = 0.17           # a fold is no nearer an end than this: envelope folds are thirds or a half
SEAM = 0.006              # either side of a fold, light grey crease is lifted back to paper
FULL_FRAME = 0.97         # a "page" this large is the photo itself — already a scan, leave it
TRIM = 0.01               # shaved off each edge after flattening, so no sliver of table survives
GHOST = 200               # show-through is lighter than this; the faintest real ink is darker at its core
INK = 185                 # ...and real ink, even small print, has a core darker than this
SNAP = 0.04               # proportions this close to A4 or Letter are taken to be that paper
A4 = 297 / 210
LETTER = 11 / 8.5


def order(pts):
    """Corners as top-left, top-right, bottom-right, bottom-left."""
    pts = pts.reshape(4, 2).astype(np.float32)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.float32([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]])


def whiteness(small):
    """Bright minus colourful: high on paper, low on almost any table — wood, a grey desk in shadow
    and a beige cloth are all either darker or more coloured than a sheet of paper."""
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    return np.clip(hsv[:, :, 2].astype(np.int16) - 2 * hsv[:, :, 1].astype(np.int16), 0, 255).astype(np.uint8)


def candidates(small):
    """Masks and edge maps to look for the page in, cheapest first. Paper on a dark table shows in
    plain edges. White paper on a light table barely does — but paper is brighter *and* less
    coloured than almost any table, so "bright minus saturated" separates the two where
    brightness alone does not."""
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    yield cv2.dilate(cv2.Canny(blur, 50, 150), k)
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    yield cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, k, iterations=3)
    _, paper = cv2.threshold(cv2.medianBlur(whiteness(small), 9), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    yield cv2.morphologyEx(cv2.morphologyEx(paper, cv2.MORPH_OPEN, k, iterations=2), cv2.MORPH_CLOSE, k, iterations=4)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(blur)
    yield cv2.dilate(cv2.Canny(clahe, 30, 100), k)


def find_page(img):
    """The page's corners, whether all four are the page's own, and its outline; or None.

    A corner on the photo's edge is where the page runs out of frame, not a corner of the paper.
    Such an outline is still the best crop there is when the page fills most of the photo — the
    usual close-up — but it says nothing about the paper's proportions."""
    h, w = img.shape[:2]
    scale = DETECT_PX / max(h, w)
    small = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]
    area = sh * sw
    partial = None
    outline = lambda c: c.reshape(-1, 2).astype(np.float64) / scale
    for edges in candidates(small):
        found = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contours = found[0] if len(found) == 2 else found[1]
        for c in sorted(contours, key=cv2.contourArea, reverse=True)[:8]:
            a = cv2.contourArea(c)
            if a < MIN_AREA * area:
                break
            if a > FULL_FRAME * area:
                continue  # the photo's own border
            hull = cv2.convexHull(c)
            approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True)
            if len(approx) != 4 or not cv2.isContourConvex(approx):
                continue
            quad = order(approx)
            margin = 3
            on_edge = ((quad[:, 0] <= margin) | (quad[:, 0] >= sw - margin) | (quad[:, 1] <= margin) | (quad[:, 1] >= sh - margin)).sum()
            if on_edge == 0:
                return quad / scale, True, outline(c)
            if partial is None and a >= PARTIAL_AREA * area:
                partial = quad / scale, False, outline(c)
    return partial if partial is not None else (None, False, None)


def paper_outline(img):
    """The page's edge as the bright-and-colourless mask sees it, with thin spurs opened away."""
    h, w = img.shape[:2]
    scale = DETECT_PX / max(h, w)
    small = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    _, mask = cv2.threshold(cv2.medianBlur(whiteness(small), 5), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.morphologyEx(cv2.morphologyEx(mask, cv2.MORPH_OPEN, k), cv2.MORPH_CLOSE, k, iterations=2)
    found = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contours = found[0] if len(found) == 2 else found[1]
    if not contours:
        return None
    return max(contours, key=cv2.contourArea).reshape(-1, 2).astype(np.float64) / scale


def paper_share(img):
    """How much of the photo is paper."""
    small = cv2.resize(img, (400, round(400 * img.shape[0] / img.shape[1])), interpolation=cv2.INTER_AREA)
    _, paper = cv2.threshold(cv2.medianBlur(whiteness(small), 9), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return float((paper > 0).mean())


def true_aspect(quad, size):
    """The page's real height/width, recovered from the camera's point of view.

    Edge lengths measured in the photo understate the side running away from the camera, so a
    page shot at an angle comes out squat. This is Zhang & He's method ("Whiteboard scanning and
    image enhancement", 2007): with the principal point at the centre of the photo and square
    pixels, the quadrilateral fixes the focal length and from it the rectangle's true proportions.
    None when the page faces the camera almost squarely — the method is undefined there, and the
    edge lengths are right anyway.
    """
    tl, tr, br, bl = (np.append(p, 1.0) for p in quad.astype(np.float64))
    u0, v0 = size[0] / 2, size[1] / 2
    k2 = np.dot(np.cross(tl, br), bl) / np.dot(np.cross(tr, br), bl)
    k3 = np.dot(np.cross(tl, br), tr) / np.dot(np.cross(bl, br), tr)
    n2, n3 = k2 * tr - tl, k3 * bl - tl
    if abs(n2[2] * n3[2]) < 1e-6:
        return None
    f2 = -(
        (n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 * u0)
        + (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0)
    ) / (n2[2] * n3[2])
    if f2 <= 0:
        return None
    a_inv = np.linalg.inv(np.array([[np.sqrt(f2), 0, u0], [0, np.sqrt(f2), v0], [0, 0, 1]]))
    b = a_inv.T @ a_inv
    width_over_height = np.sqrt((n2 @ b @ n2) / (n3 @ b @ n3))
    return 1 / width_over_height


def flatten(img, quad, whole):
    """The page inside `quad` as a rectangle of its true proportions, a hair inside its edge."""
    tl, tr, br, bl = quad
    w = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    h = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    measured = h / w
    # Only a whole page has proportions to recover; a partial one is a crop of the photo.
    aspect = true_aspect(quad, (img.shape[1], img.shape[0])) if whole else None
    # The camera model assumes a phone's lens, centred and undistorted. A cropped or edited photo
    # breaks that, and the answer it gives is then wildly off. A page shot at 40° already measures
    # at two thirds of its real height; one measured at under half of it is not a photo anyone
    # can read, so an answer further out than that is not believed.
    if aspect is None or not (measured / 2.2 < aspect < measured * 2.2):
        aspect = measured
    for paper in (A4, LETTER) if whole else ():
        for want in (paper, 1 / paper):
            if abs(aspect - want) / want < SNAP:
                aspect = want
    # Keep the longer measured side's resolution and derive the other from the true proportions.
    if h >= w:
        w = h / aspect
    else:
        h = w * aspect
    w, h = int(round(w)), int(round(h))
    m = cv2.getPerspectiveTransform(quad, np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]))
    page = cv2.warpPerspective(img, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    dx, dy = int(w * TRIM), int(h * TRIM)
    return page[dy : h - dy, dx : w - dx]


def side(contour, a, b, avoid, n=120):
    """The outline from corner a to corner b — the way round that does not pass `avoid` —
    resampled to n points evenly spaced along it."""
    near = lambda q: int(np.argmin(((contour - q) ** 2).sum(1)))
    ia, ib, iv = near(a), near(b), near(avoid)
    m = len(contour)
    run = [(ia + k) % m for k in range((ib - ia) % m + 1)]
    if iv in run:
        run = [(ia - k) % m for k in range((ia - ib) % m + 1)]
    pts = contour[run]
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    if len(pts) < 8 or d[-1] == 0:
        return None
    t = np.linspace(0, d[-1], n)
    return np.c_[np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])]


class Runs:
    """Total-least-squares error of any run of points in O(1), from prefix sums: how far a run is
    from being one straight line."""

    def __init__(self, p):
        x, y = p[:, 0], p[:, 1]
        self.s = [np.r_[0.0, np.cumsum(v)] for v in (np.ones_like(x), x, y, x * x, y * y, x * y)]

    def err(self, i, j):
        n, sx, sy, sxx, syy, sxy = (c[j] - c[i] for c in self.s)
        cxx, cyy, cxy = sxx - sx * sx / n, syy - sy * sy / n, sxy - sx * sy / n
        half = (cxx + cyy) / 2
        return max(half - np.sqrt(max(half * half - (cxx * cyy - cxy * cxy), 0.0)), 0.0)


def line(p):
    """A point on and the direction of the line that best fits p."""
    c = p.mean(0)
    _, v = np.linalg.eigh(np.cov((p - c).T))
    return c, v[:, 1]


def meet(p, q):
    """Where the lines best fitting runs p and q cross — sharper than any one point of the outline."""
    (c1, d1), (c2, d2) = line(p), line(q)
    a = np.array([d1, -d2]).T
    if abs(np.linalg.det(a)) < 1e-9:
        return (p[-1] + q[0]) / 2
    t = np.linalg.solve(a, c2 - c1)
    return c1 + t[0] * d1


def bends(p, strict=False):
    """Where one side of the page bends: (fold points, their fractions along it, fit error) for
    the best of none, one or two folds — or [] for none. A letter folded in a Z bends its sides in
    opposite directions at the two folds, so one fold explains little and two explain nearly all:
    each model is judged against the simpler ones directly, not only the next simpler.
    `strict` when one side is all the evidence there is: each fold must then explain more."""
    gain = FOLD_GAIN * (0.8 if strict else 1.0)
    n, r = len(p), Runs(p)
    lo = int(n * FOLD_MIN)
    length = np.linalg.norm(p[-1] - p[0])
    rms = lambda e: np.sqrt(e / n)
    r0 = rms(r.err(0, n))
    if r0 < FOLD_STRAIGHT * length:
        return []
    e1, i1 = min((r.err(0, i) + r.err(i, n), i) for i in range(lo, n - lo))
    e2, i2, j2 = min((r.err(0, i) + r.err(i, j) + r.err(j, n), i, j) for i in range(lo, n - 2 * lo) for j in range(i + lo, n - lo))
    r1, r2 = rms(e1), rms(e2)
    if r2 < gain * min(r0, r1):
        return [meet(p[:i2], p[i2:j2]), meet(p[i2:j2], p[j2:])], [i2 / n, j2 / n], r2 / length
    if r1 < gain * r0:
        return [meet(p[:i1], p[i1:])], [i1 / n], r1 / length
    return []


def across(point, quad, side_pts):
    """A fold seen on one side only, carried across the page: through `point`, parallel to the
    page's top and bottom edges, to where it meets the line of the other side."""
    tl, tr, br, bl = quad
    d = (tr - tl) / np.linalg.norm(tr - tl) + (br - bl) / np.linalg.norm(br - bl)
    c, e = line(side_pts)
    a = np.array([d, -e]).T
    if abs(np.linalg.det(a)) < 1e-9:
        return None
    t = np.linalg.solve(a, c - point)
    return point + t[0] * d


def find_folds(outlines, quad, size):
    """The fold lines across the page as (left point, right point) pairs, top to bottom; empty when
    the paper does not bend, or the two sides disagree about where.

    Each outline is a different reading of the page's edge — the one the page was found in, and
    the bright-and-colourless paper mask. Grain in a light wood table frays the first along the
    brighter side; a shadow on a grey desk leaks into the second. The reading whose folds fit both
    edges best is the one believed."""
    tl, tr, br, bl = quad
    best, best_err = [], None
    for contour in outlines:
        left, right = side(contour, tl, bl, tr), side(contour, tr, br, tl)
        if left is None or right is None:
            continue
        lb, rb = bends(left), bends(right)
        if lb and rb:
            if len(lb[0]) != len(rb[0]) or any(abs(a - b) > FOLD_AGREE for a, b in zip(lb[1], rb[1])):
                continue
            pairs, err = list(zip(lb[0], rb[0])), lb[2] + rb[2]
        else:
            # One side shows folds and the other none: a close-up whose other side hugs the frame,
            # or is frayed by the table. The folds are read from the side that shows them, held to
            # a stricter fit, and carried across the page.
            seen_is_left = bool(lb)
            b = bends(left if seen_is_left else right, strict=True)
            if not b:
                continue
            other = right if seen_is_left else left
            ends = [across(pt, quad, other) for pt in b[0]]
            if any(q is None for q in ends):
                continue
            pairs = [(pt, q) if seen_is_left else (q, pt) for pt, q in zip(b[0], ends)]
            err = 2 * b[2]
        if best_err is None or err < best_err:
            best, best_err = pairs, err
    return best


def on_frame(points, size, margin=8):
    """Whether any of the points sits on the photo's border — a panel cut off by the frame."""
    w, h = size
    return bool(((points[:, 0] <= margin) | (points[:, 0] >= w - margin) | (points[:, 1] <= margin) | (points[:, 1] >= h - margin)).any())


def flatten_folded(img, quad, folds, whole):
    """Each panel between two folds is flat in itself, so each is flattened on its own — its true
    height recovered from its own corners — and the panels stacked back into one page, the paper
    under each whitened separately. One correction for the whole sheet fits none of its panels."""
    size = (img.shape[1], img.shape[0])
    tl, tr, br, bl = quad
    lefts = [tl] + [f[0] for f in folds] + [bl]
    rights = [tr] + [f[1] for f in folds] + [br]
    panels = [np.float32([lefts[k], rights[k], rights[k + 1], lefts[k + 1]]) for k in range(len(lefts) - 1)]
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl), *(np.linalg.norm(f[1] - f[0]) for f in folds))
    heights = []
    for q in panels:
        pw = max(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[2] - q[3]))
        ph = max(np.linalg.norm(q[3] - q[0]), np.linalg.norm(q[2] - q[1]))
        measured = ph / pw
        aspect = None if on_frame(q, size) else true_aspect(q, size)
        if aspect is None or not (measured / 2.2 < aspect < measured * 2.2):
            aspect = measured
        heights.append(width * aspect)
    total = sum(heights)
    if whole:
        for paper in (A4, LETTER):
            if abs(total / width - paper) / paper < SNAP * 2:
                heights = [h * paper * width / total for h in heights]
                break
    w = int(round(width))
    parts = []
    for q, h in zip(panels, heights):
        h = max(int(round(h)), 8)
        m = cv2.getPerspectiveTransform(q, np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]))
        parts.append(whiten(cv2.warpPerspective(img, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)))
    page = np.vstack(parts)
    # The crease: a light grey valley along each seam. Near-paper tones are lifted toward white,
    # fully on the fold and fading to nothing at the band's edge, so no white stripe is left where
    # the paper around it carries texture or show-through. Ink that crosses the fold is darker than
    # any crease and is not touched.
    band = max(2, int(page.shape[0] * SEAM))
    y = 0
    for part in parts[:-1]:
        y += part.shape[0]
        y0, y1 = max(0, y - band), min(page.shape[0], y + band)
        strip = page[y0:y1].astype(np.float32)
        fade = 1 - np.abs(np.arange(y0, y1) - y) / band
        light = np.clip((strip.min(axis=2, keepdims=True) - 170) / 60, 0, 1)
        weight = fade[:, None, None] * light
        page[y0:y1] = np.clip(strip + (255 - strip) * weight, 0, 255).astype(np.uint8)
    H, W = page.shape[:2]
    dx, dy = int(W * TRIM), int(H * TRIM)
    return page[dy : H - dy, dx : W - dx]


def whiten(img):
    """Divide each channel by an estimate of the paper under it — the light and the shadow — so
    the paper comes out white and ink keeps its colour: a red stamp stays red, a logo stays blue."""
    h, w = img.shape[:2]
    # The paper is estimated on a quarter-size copy, with a window a tenth of the page's width:
    # wider than a logo or a heading, so ink is never mistaken for paper and washed out, and still
    # narrow enough to follow a shadow's edge. The width, not the shorter side — a panel of a
    # folded letter is short, and a window sized by it would be narrower than the logo again.
    small = cv2.resize(img, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    k = max(15, (small.shape[1] // 10) | 1)
    out = []
    for ch, sch in zip(cv2.split(img), cv2.split(small)):
        bg = cv2.morphologyEx(sch, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        bg = cv2.GaussianBlur(bg, (0, 0), k / 3)
        bg = cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR)
        out.append(cv2.divide(ch.astype(np.float32), np.maximum(bg.astype(np.float32), 1), scale=255.0))
    img = np.clip(cv2.merge(out), 0, 255)
    # Levels: paper within a few percent of white becomes white, ink gets its density back.
    lo, hi = 25.0, 235.0
    img = np.clip((img - lo) * (255.0 / (hi - lo)), 0, 255)
    return img.astype(np.uint8)


def drop_show_through(img):
    """Removes the back of the page showing through it: faint, mirrored text on white paper.

    Whitening makes the paper white but leaves show-through as light grey marks, which read as
    content. They differ from what is printed on the front in two ways: no part of them is dark —
    printed text, however small or light, has a core well below INK — and they lie on white paper,
    where a halftone fill (the grey boxes on a bill) is faint dots too, but grey on average.
    """
    h, w = img.shape[:2]
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    k = max(9, (w // 150) | 1)  # wider than a stroke of show-through, narrower than a grey box
    disc = lambda d: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))
    # The paper around each pixel, thin marks closed over.
    around = cv2.morphologyEx(g, cv2.MORPH_CLOSE, disc(k))
    # Within a few pixels of real ink: the soft edge of a letter is light, and must stay.
    ink = cv2.dilate((g < INK).astype(np.uint8), disc(2 * max(3, w // 500) + 1)) > 0
    # Grey fills, grown by the window so their own edges are not mistaken for paper.
    fill = cv2.dilate((cv2.blur(g, (2 * k + 1, 2 * k + 1)) < 238).astype(np.uint8), disc(2 * k + 1)) > 0
    ghost = (g > GHOST) & (around > 240) & ~ink & ~fill
    out = img.copy()
    out[ghost] = 255
    return out


def dpi_for(w, h, whole):
    """The resolution that prints the page at its own size. A whole page says which paper it is by
    its proportions; a close-up that runs off the edge is taken to span an A4 sheet's width, the
    near certainty for a letter photographed to fill the frame."""
    portrait = max(w, h) / min(w, h)
    short = min(w, h)
    if whole and abs(portrait - LETTER) < 0.06:
        return round(short / 8.5)
    if not whole or abs(portrait - A4) < 0.06:
        return round(short / (210 / 25.4))
    return 300


def clean(img):
    """The scan, with what was done to make it; (None, {...}) when the photo is better left alone."""
    quad, whole, contour = find_page(img)
    folds = []
    if quad is not None:
        outline = "page" if whole else "partial"
        folds = find_folds([c for c in (contour, paper_outline(img)) if c is not None], quad, (img.shape[1], img.shape[0]))
        img = flatten_folded(img, quad, folds, whole) if folds else whiten(flatten(img, quad, whole))
    elif paper_share(img) >= PAPER_SHARE:
        outline = "none"
        img = whiten(img)
    else:
        return None, {"cleaned": False, "outline": "none"}
    img = drop_show_through(img)
    h, w = img.shape[:2]
    return img, {"cleaned": True, "outline": outline, "folds": len(folds), "dpi": dpi_for(w, h, whole), "width": w, "height": h}


def self_test():
    """A page of ruled lines photographed at an angle on a dark table must come back found, flat
    and A4. Run when the worker image is built, so a broken OpenCV install fails the build rather
    than leaving every photo silently uncleaned."""
    page = np.full((1188, 840, 3), 250, np.uint8)
    for y in range(120, 1100, 36):
        cv2.line(page, (90, y), (750, y), (40, 40, 40), 3)
    photo = np.full((2000, 1500, 3), (40, 60, 90), np.uint8)
    # Where the corners land through a real lens: an A4 sheet tipped 30° away and turned 5°, 400 mm
    # from a camera of focal length 1550 px. Arbitrary corners would be no photo of a rectangle.
    a, b = np.radians(30), np.radians(5)
    tip = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
    turn = np.array([[np.cos(b), -np.sin(b), 0], [np.sin(b), np.cos(b), 0], [0, 0, 1]])
    sheet = np.array([[-105, -148.5, 0], [105, -148.5, 0], [105, 148.5, 0], [-105, 148.5, 0]])
    p = sheet @ (tip @ turn).T + [0, 0, 400]
    corners = np.float32([[750 + 1550 * x / z, 1000 + 1550 * y / z] for x, y, z in p])
    m = cv2.getPerspectiveTransform(np.float32([[0, 0], [839, 0], [839, 1187], [0, 1187]]), corners)
    mask = cv2.warpPerspective(np.full(page.shape[:2], 255, np.uint8), m, (1500, 2000))
    photo[mask > 0] = cv2.warpPerspective(page, m, (1500, 2000))[mask > 0]
    out, info = clean(photo)
    assert out is not None and info["outline"] == "page", info
    assert abs(out.shape[0] / out.shape[1] - A4) < 0.02, info
    print(json.dumps({"self_test": "ok", **info}))


def main():
    if sys.argv[1:] == ["--self-test"]:
        return self_test()
    src, dst = sys.argv[1], sys.argv[2]
    img = cv2.imread(src, cv2.IMREAD_COLOR)  # applies the photo's EXIF orientation
    if img is None:
        sys.exit(f"cannot read {src}")
    out, info = clean(img)
    if out is not None:
        cv2.imwrite(dst, out, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(json.dumps(info))


if __name__ == "__main__":
    main()
