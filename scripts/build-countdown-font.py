"""从缓存的 OFL Bungee 源字体生成 HUD 数字子集。"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
root = Path(__file__).resolve().parents[1]
font = TTFont(root / '.cache/ui-fonts/bungee/Bungee-Regular.ttf')
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(text='0123456789')
subsetter.subset(font)
font.save(root / 'assets/race/fonts/Bungee-Regular.ttf')
