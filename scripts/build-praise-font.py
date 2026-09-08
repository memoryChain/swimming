"""生成圆润评价字库；OFL 保留名 Changa 不用于修改后的子集名称。"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
root=Path(__file__).resolve().parents[1]
f=TTFont(root/'.cache/ui-fonts/changa/ChangaOne-Regular.ttf')
o=subset.Options();o.name_IDs=['*'];o.name_legacy=True;o.name_languages=['*']
s=subset.Subsetter(options=o);s.populate(text='GoodGreatExcellentPerfectAmazingCrazyUnbelievable');s.subset(f)
for n in f['name'].names:
 if n.nameID in (1,2,3,4,6,16,17):
  value='Regular' if n.nameID in (2,17) else ('ShuiMasterPraise-Regular' if n.nameID in (3,6) else 'ShuiMaster Praise')
  n.string=value.encode(n.getEncoding())
f.save(root/'assets/race/fonts/ShuiMasterPraise-Regular.ttf')
