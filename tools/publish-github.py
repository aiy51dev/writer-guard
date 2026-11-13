#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键发布到 GitHub（建仓库 → 上传代码 → 开 Pages → 传 Release → 探活）。

用法：
    export GH_TOKEN=ghp_xxx          # bash
    $env:GH_TOKEN="ghp_xxx"          # PowerShell
    python tools/publish-github.py

为什么不用 git push：部分网络下 github.com:443 极慢（TCP 20s+ 超时），
而 api.github.com 通畅。所以代码通过 Git Data API（blob → tree → commit → ref）
上传，等价于一次完整提交。git push 只作为兜底。

令牌权限：classic PAT 勾 repo（要传 Release 再勾 workflow）。
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OWNER = "aiy51dev"
REPO = "writer-guard"
BRANCH = "main"
SITE_PATH = "/docs"
SITE_URL = "https://%s.github.io/%s/" % (OWNER, REPO)

# 已有站点的仓库：绝不允许覆盖（aiy51dev.github.io 是导航页站点）
PROTECTED = {"aiy51dev.github.io"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.github.com"
UA = "writer-guard-publisher"

TOKEN = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()


def die(msg):
    print("\n[失败] " + msg)
    sys.exit(1)


def step(n, msg):
    print("\n[%d] %s" % (n, msg))


def api(method, path, body=None, raw=None, timeout=90):
    url = path if path.startswith("http") else API + path
    headers = {
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": UA,
    }
    data = None
    if raw is not None:
        data = raw
        headers["Content-Type"] = "application/zip"
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode("utf-8")
            return r.status, (json.loads(txt) if txt.strip() else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, {"message": txt[:300]}
    except urllib.error.URLError as e:
        return 0, {"message": "网络不通：%s" % e}


def git(*args):
    return subprocess.run(["git"] + list(args), cwd=ROOT, capture_output=True, text=True)


def tracked_files():
    """.gitignore 已经过滤过：git ls-files 就是该上传的清单。"""
    r = git("ls-files", "-z")
    if r.returncode != 0:
        die("读不到 git 文件清单：" + (r.stderr or "")[:300])
    return [p for p in r.stdout.split("\0") if p]


def upload_via_api(files, msg):
    """blob → tree → commit → 更新 ref，等价于一次 git push。"""
    def put_blob(rel):
        full = os.path.join(ROOT, rel.replace("/", os.sep))
        with open(full, "rb") as f:
            blob = f.read()
        payload = {"content": base64.b64encode(blob).decode(), "encoding": "base64"}
        last = "未知错误"
        # 这条线路 TLS 握手会偶发超时，重试三次就够
        for attempt in range(4):
            st, d = api("POST", "/repos/%s/%s/git/blobs" % (OWNER, REPO), payload, timeout=120)
            if st in (200, 201):
                return ({"path": rel, "mode": "100644", "type": "blob", "sha": d["sha"]}, len(blob))
            last = (d or {}).get("message") or ("HTTP %s" % st)
            time.sleep(1.5 * (attempt + 1))
        raise RuntimeError("blob 失败 %s：%s" % (rel, last))

    state = {"n": 0}

    def work(rel):
        r = put_blob(rel)
        state["n"] += 1
        if state["n"] % 20 == 0 or state["n"] == len(files):
            print("    已上传 %d/%d" % (state["n"], len(files)))
        return r

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(work, files))
    entries = [r[0] for r in results]
    total = sum(r[1] for r in results)

    st, tree = api("POST", "/repos/%s/%s/git/trees" % (OWNER, REPO), {"tree": entries})
    if st not in (200, 201):
        die("建 tree 失败：%s" % (tree or {}).get("message"))
    print("    共 %d 个文件 / %.2f MB" % (len(entries), total / 1048576))

    parents = []
    st, ref = api("GET", "/repos/%s/%s/git/ref/heads/%s" % (OWNER, REPO, BRANCH))
    if st == 200 and ref:
        parents = [ref["object"]["sha"]]

    st, cm = api("POST", "/repos/%s/%s/git/commits" % (OWNER, REPO),
                 {"message": msg, "tree": tree["sha"], "parents": parents})
    if st not in (200, 201):
        die("建 commit 失败：%s" % (cm or {}).get("message"))

    if parents:
        st, _ = api("PATCH", "/repos/%s/%s/git/refs/heads/%s" % (OWNER, REPO, BRANCH),
                    {"sha": cm["sha"], "force": True})
    else:
        st, _ = api("POST", "/repos/%s/%s/git/refs" % (OWNER, REPO),
                    {"ref": "refs/heads/" + BRANCH, "sha": cm["sha"]})
    if st not in (200, 201):
        die("更新分支失败（%s）" % st)
    print("    已提交：%s" % cm["sha"][:7])


def main():
    if not TOKEN:
        die("没找到令牌。先设置环境变量 GH_TOKEN，再重跑。")
    if REPO in PROTECTED:
        die("仓库 %s 已承载其它站点，禁止覆盖。" % REPO)

    mf = os.path.join(ROOT, "manifest.json")
    with open(mf, encoding="utf-8") as f:
        ver = json.load(f).get("version", "0.0.0")
    tag = "v" + ver
    zip_path = os.path.join(ROOT, "dist", "writer-guard-%s.zip" % tag)

    # ---------- 0 ----------
    step(0, "校验令牌")
    st, me = api("GET", "/user")
    if st != 200:
        die("令牌无效（%s）：%s" % (st, (me or {}).get("message")))
    login = me.get("login", "")
    print("    身份：%s" % login)
    if login.lower() != OWNER.lower():
        die("令牌属于 %s，不是 %s，换个令牌。" % (login, OWNER))

    # ---------- 1 ----------
    step(1, "确认仓库 %s/%s" % (OWNER, REPO))
    st, data = api("GET", "/repos/%s/%s" % (OWNER, REPO))
    if st == 200:
        print("    已存在：%s" % data.get("html_url"))
        if data.get("private"):
            print("    注意：私有仓库在免费账号下 Pages 不对外")
    elif st == 404:
        body = {
            "name": REPO,
            "description": "公众号发布安全台 · Writer Guard —— 写稿/排版/红线检测/封面/数据复盘，一个浏览器扩展全包",
            "homepage": SITE_URL,
            "private": False,
            "has_issues": True,
            "has_wiki": False,
            "auto_init": False,
        }
        st2, d2 = api("POST", "/user/repos", body)
        if st2 not in (200, 201):
            die("建仓库失败（%s）：%s" % (st2, (d2 or {}).get("message")))
        print("    已创建：%s" % d2.get("html_url"))
        time.sleep(2)
    else:
        die("查询仓库失败（%s）：%s" % (st, (data or {}).get("message")))

    # ---------- 2 ----------
    step(2, "上传代码到 %s" % BRANCH)
    # 全新空仓库没有任何 git 对象时，Git Data API 会拒绝建 blob（409 Git Repository is empty），
    # 先用 Contents API 打一次初始提交，再走 blob → tree → commit
    st, _ = api("GET", "/repos/%s/%s/git/ref/heads/%s" % (OWNER, REPO, BRANCH))
    if st != 200:
        st2, d2 = api("PUT", "/repos/%s/%s/contents/.gitkeep" % (OWNER, REPO),
                      {"message": "chore: 初始化仓库", "content": base64.b64encode(b"\n").decode()})
        if st2 not in (200, 201):
            die("空仓库初始化失败（%s）：%s" % (st2, (d2 or {}).get("message")))
        print("    空仓库已初始化")
    files = tracked_files()
    print("    待上传 %d 个文件" % len(files))
    msg = "chore: Writer Guard %s 初始发布\n\n扩展源码 + GitHub Pages 落地页（docs/）" % tag
    upload_via_api(files, msg)

    # ---------- 3 ----------
    step(3, "开启 Pages（%s %s）" % (BRANCH, SITE_PATH))
    src = {"source": {"branch": BRANCH, "path": SITE_PATH}}
    st, data = api("GET", "/repos/%s/%s/pages" % (OWNER, REPO))
    if st == 404:
        st2, d2 = api("POST", "/repos/%s/%s/pages" % (OWNER, REPO), dict(src, build_type="legacy"))
        if st2 not in (200, 201, 204):
            print("    自动开启失败（%s）：%s" % (st2, (d2 or {}).get("message")))
            print("    → Settings → Pages 手动选 %s / %s" % (BRANCH, SITE_PATH))
        else:
            print("    已开启")
    elif st == 200:
        st2, d2 = api("PUT", "/repos/%s/%s/pages" % (OWNER, REPO), src)
        ok = st2 in (200, 204)
        print("    已开启，来源更新%s" % ("成功" if ok else "失败：" + str((d2 or {}).get("message"))))
    else:
        print("    查询失败（%s）：%s" % (st, (data or {}).get("message")))

    # ---------- 4 ----------
    step(4, "Release %s" % tag)
    if not os.path.exists(zip_path):
        print("    先打包…")
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build-release.py")], cwd=ROOT)
    if not os.path.exists(zip_path):
        print("    跳过：%s 不存在" % zip_path)
    else:
        st, rel = api("GET", "/repos/%s/%s/releases/tags/%s" % (OWNER, REPO, tag))
        if st != 200:
            body = {
                "tag_name": tag,
                "target_commitish": BRANCH,
                "name": "Writer Guard " + tag,
                "body": ("## 安装\n\n"
                         "1. 下载 `writer-guard-%s.zip` 解压到固定目录\n"
                         "2. 打开 `edge://extensions`（Chrome 用 `chrome://extensions`）\n"
                         "3. 打开右上角「开发人员模式」→「加载解压缩的扩展」→ 选解压出来的文件夹\n"
                         "4. 打开公众号图文编辑页，右下角出现「封面 / 豆包 / 编辑台 / 安全台」\n\n"
                         "> 扩展不能从网页直接安装，必须走「加载解压缩的扩展」或应用商店。\n\n"
                         "官网与使用文档：%s\n" % (tag, SITE_URL)),
                "draft": False,
                "prerelease": False,
            }
            st, rel = api("POST", "/repos/%s/%s/releases" % (OWNER, REPO), body)
            if st not in (200, 201):
                print("    创建失败（%s）：%s" % (st, (rel or {}).get("message")))
                rel = None
            else:
                print("    已创建：%s" % rel.get("html_url"))

        if rel:
            name = os.path.basename(zip_path)
            if any(a.get("name") == name for a in (rel.get("assets") or [])):
                print("    安装包已在，跳过")
            else:
                with open(zip_path, "rb") as f:
                    blob = f.read()
                up = "https://uploads.github.com/repos/%s/%s/releases/%s/assets?name=%s" % (
                    OWNER, REPO, rel["id"], name)
                st, a = api("POST", up, raw=blob, timeout=180)
                if st not in (200, 201):
                    print("    上传失败（%s）：%s" % (st, (a or {}).get("message")))
                else:
                    print("    已上传 %s（%.2f MB）" % (name, a.get("size", len(blob)) / 1048576))

    # ---------- 5 ----------
    step(5, "等 Pages 构建")
    for i in range(24):
        st, b = api("GET", "/repos/%s/%s/pages/builds/latest" % (OWNER, REPO))
        if st == 200 and b:
            if b.get("status") == "built":
                print("    构建完成")
                break
            if b.get("status") == "errored":
                print("    构建出错，去仓库 Actions / Pages 看日志")
                break
        time.sleep(5)
        print("    等待 %ds…" % ((i + 1) * 5))

    # ---------- 6 ----------
    step(6, "探活 %s" % SITE_URL)
    ok = False
    for i in range(12):
        try:
            req = urllib.request.Request(SITE_URL + "?t=%d" % int(time.time()),
                                         headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status == 200:
                    html = r.read(6000).decode("utf-8", "replace")
                    print("    HTTP 200，标题命中：%s" % ("公众号发布安全台" in html))
                    ok = True
                    break
        except Exception as e:
            print("    还没好（%s）" % type(e).__name__)
        time.sleep(10)

    print("\n" + "=" * 60)
    print("仓库：https://github.com/%s/%s" % (OWNER, REPO))
    print("站点：%s %s" % (SITE_URL, "可访问" if ok else "构建中（首次 1-2 分钟）"))
    print("下载：https://github.com/%s/%s/releases/latest" % (OWNER, REPO))
    print("导航页：https://%s.github.io/ （未改动）" % OWNER)
    print("=" * 60)


if __name__ == "__main__":
    main()
