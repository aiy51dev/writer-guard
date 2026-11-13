# -*- coding: utf-8 -*-
"""
把两个独立 HTML 应用原样内置进扩展。

输入：
  tools/studio-src/emotion.html   （情绪导演 REDSkill）
  tools/studio-src/zhilu.html     （智录笔记 260522 完整版）
  tools/wg-studio-bridge.js       （桥接脚本，内联注入）

输出：
  studio/emotion.html
  studio/zhilu.html

只做两类改动，业务代码一行不删：
  1. 在 <body> 之后内联注入桥接脚本（localStorage 兜底 / fetch 反代 / 下载中转 / 弹窗接管）
  2. 智录笔记里 5 处原生 confirm/prompt 换成桥接的页内弹窗（沙箱里原生弹窗可能被拦）
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'studio-src')
OUT = os.path.join(ROOT, 'studio')
BRIDGE = os.path.join(HERE, 'wg-studio-bridge.js')

# (文件, 原文, 新文, 说明)
PATCHES = {
    'zhilu.html': [
        ("function onNavThumbClick(el, noteIdx, deleted){",
         "async function onNavThumbClick(el, noteIdx, deleted){",
         "恢复截图：函数改 async"),
        ("if (confirm('恢复这张截图为新的笔记片段？')) {",
         "if (await wgConfirm('恢复这张截图为新的笔记片段？')) {",
         "恢复截图：confirm → wgConfirm"),
        ("if(toMark.length===0 && !confirm(\"没有新字幕，继续保存？\")) return;",
         "if(toMark.length===0 && !(await wgConfirm(\"没有新字幕，继续保存？\"))) return;",
         "保存截图：confirm → wgConfirm"),
        ("function clearAll(){ if(confirm(\"清空所有？\")){",
         "async function clearAll(){ if(await wgConfirm(\"清空所有？\")){",
         "清空：confirm → wgConfirm"),
        ("window.vp_resetCharacters = function() {",
         "window.vp_resetCharacters = async function() {",
         "重置人物：函数改 async"),
        ("if (confirm('确定要恢复默认人物预设吗？当前已编辑的人物将被覆盖。')) {",
         "if (await wgConfirm('确定要恢复默认人物预设吗？当前已编辑的人物将被覆盖。')) {",
         "重置人物：confirm → wgConfirm"),
        ("function captureCurrentFrameAsNote(){",
         "async function captureCurrentFrameAsNote(){",
         "抓帧记笔记：函数改 async"),
        ("let txt=prompt(\"笔记文字:\");",
         "let txt=await wgPrompt(\"笔记文字:\");",
         "抓帧记笔记：prompt → wgPrompt"),
    ],
    'emotion.html': [],
}


def build(name):
    path = os.path.join(SRC, name)
    html = io.open(path, encoding='utf-8-sig').read()   # 去掉 BOM
    bridge = io.open(BRIDGE, encoding='utf-8').read()

    app = name.replace('.html', '')
    snippet = '<script>\n' + bridge.replace('__WG_APP__', app) + '\n</script>\n'

    # 1) 注入桥接
    m = re.search(r'<body[^>]*>', html, re.I)
    if not m:
        raise SystemExit('[x] %s 找不到 <body>' % name)
    html = html[:m.end()] + '\n' + snippet + html[m.end():]

    # 2) 业务补丁
    for old, new, desc in PATCHES.get(name, []):
        cnt = html.count(old)
        if cnt != 1:
            raise SystemExit('[x] %s 补丁命中 %d 次（应为 1）：%s\n    %s' % (name, cnt, desc, old[:60]))
        html = html.replace(old, new)

    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, name)
    io.open(dst, 'w', encoding='utf-8', newline='\n').write(html)

    left = len(re.findall(r'\b(?:confirm|prompt)\s*\(', html)) - html.count('wgConfirm(') - html.count('wgPrompt(')
    print('  %-14s %7.1f KB  %5d 行  剩余原生 confirm/prompt: %d' % (
        name, os.path.getsize(dst) / 1024.0, html.count('\n') + 1, max(left, 0)))


def main():
    if not os.path.exists(BRIDGE):
        raise SystemExit('[x] 缺少 tools/wg-studio-bridge.js')
    print('构建 studio 页面：')
    for name in ('emotion.html', 'zhilu.html'):
        build(name)
    print('完成 → studio/')


if __name__ == '__main__':
    sys.exit(main())
