# -*- coding: utf-8 -*-
"""打包可安装的扩展 zip（用于 GitHub Releases）。

用法：
    python tools/build-release.py

产物：dist/writer-guard-v<manifest 版本号>.zip
解压后得到同名文件夹，直接「加载已解压的扩展程序」选中它即可。

只打包运行时需要的文件，测试脚本、截图、Pages 站点、git 目录都排除，
避免压缩包变成几十 MB 还带上无关文件。
"""
import io
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 运行扩展必需的顶层条目
INCLUDE = [
    'manifest.json',
    'background.js',
    'content',
    'data',
    'icons',
    'popup',
    'studio',
    'workbench',
    'welcome.html',
    'README.md',
    'LICENSE',
]

# 任何层级都不要的东西
SKIP_DIRS = {'__pycache__', '.git', 'node_modules'}
SKIP_EXT = {'.pyc', '.log', '.zip'}


def version():
    with io.open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8') as f:
        return json.load(f)['version']


def add_path(zf, arc, path):
    """arc：在压缩包里的完整路径（正斜杠），必须逐层带上文件名，别复用父目录名。"""
    if os.path.isdir(path):
        for name in sorted(os.listdir(path)):
            if name in SKIP_DIRS:
                continue
            add_path(zf, arc + '/' + name, os.path.join(path, name))
        return
    ext = os.path.splitext(path)[1].lower()
    if ext in SKIP_EXT:
        return
    zf.write(path, arc)


def main():
    ver = version()
    name = 'writer-guard-v' + ver
    out_dir = os.path.join(ROOT, 'dist')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, name + '.zip')

    missing = [p for p in INCLUDE if not os.path.exists(os.path.join(ROOT, p))]
    if missing:
        print('缺少必需文件：' + ', '.join(missing))
        return 1

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for entry in INCLUDE:
            add_path(zf, name + '/' + entry.replace(os.sep, '/'), os.path.join(ROOT, entry))

    size = os.path.getsize(out) / 1024 / 1024
    with zipfile.ZipFile(out) as zf:
        count = len(zf.namelist())
        bad = [n for n in zf.namelist() if '\\' in n]
    print('%s  %.2f MB  %d 个文件' % (out, size, count))
    if bad:
        print('警告：压缩包里出现了反斜杠路径，Chrome 可能装不上：' + str(bad[:3]))
        return 1
    print('解压后选中的文件夹：' + name)
    return 0


if __name__ == '__main__':
    sys.exit(main())
