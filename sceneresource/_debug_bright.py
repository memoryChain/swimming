import bpy
import math

TIER = (1.0, 0.46, 0.18, 0.05)
DIST_MIN = 0.45
NEAR = 6.0
POOL_MIN_X, POOL_MAX_X, HALF_Y = 0.0, 50.0, 10.5
KW = ('bleacher', 'grandstand', 'stand', 'corner', 'olympicpanel', 'platform')


def is_stand(n):
    return any(k in n.lower() for k in KW)


def pdist(x, y):
    dx = POOL_MIN_X - x if x < POOL_MIN_X else (x - POOL_MAX_X if x > POOL_MAX_X else 0.0)
    ay = abs(y)
    dy = ay - HALF_Y if ay > HALF_Y else 0.0
    return math.hypot(dx, dy)


centers = []
for t in range(1, 5):
    lo, hi = math.inf, -math.inf
    for o in bpy.data.objects:
        if o.type == 'MESH' and f'bleacherbatch_t{t}' in o.name.lower():
            mw = o.matrix_world
            for v in o.data.vertices:
                z = (mw @ v.co).z
                lo = min(lo, z)
                hi = max(hi, z)
    centers.append((lo + hi) / 2 if math.isfinite(lo) else None)
maxd = 0.0
for o in bpy.data.objects:
    if o.type == 'MESH' and not o.hide_render and is_stand(o.name):
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co
            maxd = max(maxd, pdist(w.x, w.y))
spand = max(1e-4, maxd - NEAR)


def tb(z):
    if z <= centers[0]:
        return TIER[0]
    if z >= centers[-1]:
        return TIER[-1]
    for i in range(3):
        a, b = centers[i], centers[i + 1]
        if a <= z <= b:
            t = (z - a) / max(1e-4, b - a)
            return TIER[i] + (TIER[i + 1] - TIER[i]) * t
    return TIER[-1]


def db(d):
    t = max(0.0, min(1.0, (d - NEAR) / spand))
    return 1.0 - (1.0 - DIST_MIN) * t


print('CENTERS', [round(c, 2) for c in centers], 'MAXD', round(maxd, 1))
corner, mid = [], []
for o in bpy.data.objects:
    if o.type != 'MESH' or o.hide_render:
        continue
    mw = o.matrix_world
    for p in o.data.polygons:
        mat = o.material_slots[p.material_index].material if p.material_index < len(o.material_slots) else None
        mn = mat.name.lower() if mat else ''
        if 'silvergray' not in mn:
            continue
        c = mw @ p.center
        if abs(c.y) < 18 and not (c.x < 2 or c.x > 48):
            continue
        b = min(tb(c.z), db(pdist(c.x, c.y)))
        rec = (round(c.x, 1), round(c.y, 1), round(c.z, 1), round(b, 2))
        if c.x < 2 or c.x > 48:
            corner.append(rec)
        else:
            mid.append(rec)
corner.sort(key=lambda r: r[2])
mid.sort(key=lambda r: r[2])
print('CORNER back-wall (x,y,z,bright):', corner[:10])
print('MID back-wall (x,y,z,bright):', mid[:10])
