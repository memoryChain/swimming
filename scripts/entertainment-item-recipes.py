"""六种娱乐道具的部件配方；坐标使用 Cocos 的米制、Y 轴向上。"""
import math

ITEMS = {
    'StimulantBottle': {'parts': ['BottleBody', 'DrinkCore', 'Neck', 'Collar', 'Cap', 'BadgeFront', 'BadgeBack']},
    'CalmSlush': {'parts': ['Cup', 'Slush', 'Straw', 'SnowflakeFrontVertical', 'SnowflakeFrontSlash',
                            'SnowflakeFrontBackslash', 'SnowflakeBackVertical', 'SnowflakeBackSlash', 'SnowflakeBackBackslash']},
    'ColaBottle': {'segments': 10, 'rings': 12},
    'CrushedWaterBottle': {'segments': 8, 'rings': 11},
    'SportDrinkBottle': {'segments': 10, 'rings': 10},
    'MealTray': {'parts': ['TrayBase', 'Lid', 'RimFront', 'RimBack', 'RimLeft', 'RimRight', 'Hinge', 'FoodStain', 'Divider']},
}

CONTACTS = {
    'StimulantBottle': [('BottleBody', 'Neck'), ('Neck', 'Collar'), ('Collar', 'Cap'),
                        ('BottleBody', 'BadgeFront'), ('BottleBody', 'BadgeBack')],
    'CalmSlush': [('Cup', 'Slush'), ('Slush', 'Straw')]
        + [('Cup', part) for part in ITEMS['CalmSlush']['parts'] if part.startswith('Snowflake')],
    'MealTray': [('TrayBase', 'Lid'), ('Lid', 'FoodStain'), ('Lid', 'Divider'), ('TrayBase', 'Hinge')]
        + [('TrayBase', part) for part in ITEMS['MealTray']['parts'] if part.startswith('Rim')],
}


def components(reference):
    """按实际接边拆分功能部件，同时保留硬边两侧独立的角点颜色。"""
    points = list(zip(*[iter(reference['positions'])] * 3))
    colors = list(zip(*[iter(reference['colors'])] * 4))
    triangles = list(zip(*[iter(reference['indices'])] * 3))
    keys = [tuple(round(v, 7) for v in point) for point in points]
    adjacency = {key: set() for key in keys}
    for triangle in triangles:
        corners = [keys[i] for i in triangle]
        for key in corners:
            adjacency[key].update(corners)
    seen = set()
    result = []
    for key in keys:
        if key in seen:
            continue
        connected, pending = set(), [key]
        while pending:
            current = pending.pop()
            if current in connected:
                continue
            connected.add(current)
            pending.extend(adjacency[current] - connected)
        seen.update(connected)
        local, vertices, faces, corner_colors = {}, [], [], []
        for triangle in triangles:
            if keys[triangle[0]] not in connected:
                continue
            face = []
            for index in triangle:
                if keys[index] not in local:
                    local[keys[index]] = len(vertices)
                    vertices.append(points[index])
                face.append(local[keys[index]])
            faces.append(face)
            corner_colors.append([colors[index] for index in triangle])
        result.append((vertices, faces, corner_colors))
    return result


def bottle(reference, segments, rings):
    """从已确认的截面重建连续四边面瓶身，两个端盖使用完整面。"""
    vertices = list(zip(*[iter(reference['positions'])] * 3))
    colors = list(zip(*[iter(reference['colors'])] * 4))
    assert len(vertices) == segments * rings
    faces = []
    for ring in range(rings - 1):
        for side in range(segments):
            nxt = (side + 1) % segments
            faces.append([ring * segments + side, ring * segments + nxt,
                          (ring + 1) * segments + nxt, (ring + 1) * segments + side])
    faces.append(list(reversed(range(segments))))
    faces.append([(rings - 1) * segments + i for i in range(segments)])
    return vertices, faces, [[colors[index] for index in face] for face in faces]


def recipe(item_id, reference):
    spec = ITEMS[item_id]
    if 'segments' in spec:
        return [('Bottle', *bottle(reference, spec['segments'], spec['rings']))]
    parts = components(reference)
    assert len(parts) == len(spec['parts']), (item_id, len(parts))
    result = []
    for name, (vertices, faces, colors) in zip(spec['parts'], parts):
        # 餐盒原型的盖、污渍、分隔条各悬空 1mm；只延伸底面使其接触。
        if item_id == 'MealTray' and name in ('Lid', 'FoodStain', 'Divider'):
            base = min(p[2] for p in vertices)
            vertices = [(x, y, z - .001 if math.isclose(z, base, abs_tol=1e-8) else z)
                        for x, y, z in vertices]
        if item_id == 'MealTray' and name.startswith('Rim'):
            vertices = [(x, y, .005 if math.isclose(z, .012, abs_tol=1e-8) else z)
                        for x, y, z in vertices]
        # 雪花原型内表面距杯壁约 14mm；保留外表面，向内延伸至杯壁。
        if item_id == 'CalmSlush' and name.startswith('Snowflake'):
            vertices = [(x, y, math.copysign(.28, z) if math.isclose(abs(z), .3075, abs_tol=1e-6) else z)
                        for x, y, z in vertices]
        result.append((name, vertices, faces, colors))
    return result
