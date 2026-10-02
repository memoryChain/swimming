#!/usr/bin/env python3
"""构建期生成 TapTap 独立字体族；只修改输出包，不触碰源 TTF 或 Cocos 元数据。"""
import argparse
import hashlib
import io
import json
from pathlib import Path
from fontTools.ttLib import TTFont

FACES = {
    "ShuiMasterUI-Regular.ttf": ("ShuiMasterUIRegular", 400),
    "ShuiMasterUI-SemiBold.ttf": ("ShuiMasterUISemiBold", 600),
}


def transform(data: bytes, filename: str) -> tuple[bytes, dict]:
    family, weight = FACES[filename]
    font = TTFont(io.BytesIO(data), recalcTimestamp=False)
    if font["OS/2"].usWeightClass != weight:
        raise ValueError("字体字重不匹配：" + filename)
    original_family = font["name"].getDebugName(1)
    if original_family not in ("ShuiMaster UI", family):
        raise ValueError("字体族不符合项目约定：" + str(original_family))
    before = {tag: font.reader[tag] for tag in font.reader.keys()}
    # TapTap 返回 family 字符串给 Cocos；每个实际字重必须拥有独立的可寻址字体族。
    # 同步 legacy/typographic/WWS 名称，保留字形、真实字重及授权文本。
    values = {1: family, 2: "Regular", 3: family, 4: family, 6: family,
              16: family, 17: "Regular", 21: family, 22: "Regular"}
    names = font["name"]
    for record in list(names.names):
        if record.nameID in values:
            names.setName(values[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
    for name_id, value in values.items():
        names.setName(value, name_id, 3, 1, 0x409)
        names.setName(value, name_id, 1, 0, 0)
    stream = io.BytesIO()
    font.save(stream, reorderTables=False)
    output = stream.getvalue()
    after = TTFont(io.BytesIO(output), recalcTimestamp=False)
    if set(before) != set(after.reader.keys()):
        raise ValueError("字体表集合发生非预期变化")
    for tag, content in before.items():
        # head 只有整文件校验和可变，其他字节也必须保持一致。
        actual = after.reader[tag]
        if tag == "name":
            continue
        if tag == "head":
            content = content[:8] + b"\0" * 4 + content[12:]
            actual = actual[:8] + b"\0" * 4 + actual[12:]
        if content != actual:
            raise ValueError("非名称字体表发生变化：" + tag)
    return output, {"file": filename, "old_family": original_family, "family": family,
                    "weight": weight, "before_sha256": hashlib.sha256(data).hexdigest(),
                    "sha256": hashlib.sha256(output).hexdigest(), "glyph_tables_unchanged": True}


def prepare(game: Path) -> list[dict]:
    game = game.resolve()
    project = Path(__file__).resolve().parents[1]
    # 只允许构建目录，防止误把 assets 或源字体作为输出目录。
    if not game.is_relative_to(project / "build") or not (game / "game.json").is_file():
        raise ValueError("目标必须是本项目 build 下含 game.json 的转换包目录")
    pending = []
    for filename in FACES:
        matches = list(game.rglob(filename))
        if len(matches) != 1:
            raise ValueError("字体数量不为一：" + filename)
        file = matches[0]
        if not file.resolve().is_relative_to(game):
            raise ValueError("字体路径越界")
        data, report = transform(file.read_bytes(), filename)
        report["path"] = file.relative_to(game).as_posix()
        pending.append((file, data, report))
    for file, data, _ in pending:
        file.write_bytes(data)
    return [report for _, _, report in pending]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("game_dir", type=Path)
    print(json.dumps(prepare(parser.parse_args().game_dir), ensure_ascii=False, indent=2))
