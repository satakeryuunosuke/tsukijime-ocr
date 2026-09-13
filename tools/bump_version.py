#!/usr/bin/env python3
"""
tools/bump_version.py
=====================
システム全体のバージョン引き上げ（バージョンバンプ）自動化スクリプト。

【更新対象】
1. src/version.js  -> export const APP_VERSION = "vXX";
2. sw.js           -> const CACHE = "tsukijime-ocr-vXX";
3. sw.js (PRECACHE)-> src/ および src/views/ 配下の未登録スクリプトの補完・整合性確保

【使用方法】
  # 1. 自動で1つインクリメント (例: v27 -> v28)
  python tools/bump_version.py

  # 2. バージョンを直接指定
  python tools/bump_version.py v28
  python tools/bump_version.py 28

  # 3. 変更せず確認のみ（dry-run）
  python tools/bump_version.py --dry-run

  # 4. 現在のバージョン整合性チェック
  python tools/bump_version.py --check
"""

import sys
import os
import re
import argparse
from pathlib import Path

# Windows環境での日本語出力対応
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent
VERSION_JS = ROOT_DIR / "src" / "version.js"
SW_JS = ROOT_DIR / "sw.js"
SRC_DIR = ROOT_DIR / "src"
VIEWS_DIR = SRC_DIR / "views"


def parse_version_str(ver_str: str):
    """
    'v27' -> ('27', 'v')
    '27' -> ('27', '')
    'v27.1' -> ('27.1', 'v') など
    """
    clean = ver_str.strip()
    prefix = "v" if clean.startswith("v") or clean.startswith("V") else ""
    num_part = clean.lstrip("vV")
    return num_part, prefix


def get_current_versions():
    """src/version.js と sw.js から現在のバージョンを抽出"""
    if not VERSION_JS.exists():
        raise FileNotFoundError(f"Not found: {VERSION_JS}")
    if not SW_JS.exists():
        raise FileNotFoundError(f"Not found: {SW_JS}")

    v_content = VERSION_JS.read_text(encoding="utf-8")
    m_v = re.search(r'APP_VERSION\s*=\s*["\']([^"\']+)["\']', v_content)
    app_version = m_v.group(1) if m_v else None

    sw_content = SW_JS.read_text(encoding="utf-8")
    m_sw = re.search(r'CACHE\s*=\s*["\']tsukijime-ocr-([^"\']+)["\']', sw_content)
    sw_version = m_sw.group(1) if m_sw else None

    return app_version, sw_version


def increment_version(ver_str: str) -> str:
    """
    v27 -> v28
    27 -> 28
    v1.2.3 -> v1.2.4
    """
    num_part, prefix = parse_version_str(ver_str)
    # 単純な整数値の場合 (v27 など)
    if num_part.isdigit():
        return f"{prefix or 'v'}{int(num_part) + 1}"

    # セマンティックバージョニング形式 (1.2.3 等)
    parts = num_part.split(".")
    if parts and parts[-1].isdigit():
        parts[-1] = str(int(parts[-1]) + 1)
        return f"{prefix or 'v'}{'.'.join(parts)}"

    raise ValueError(f"バージョンの自動インクリメントができませんでした: '{ver_str}'")


def update_version_js(new_version: str, dry_run: bool = False):
    content = VERSION_JS.read_text(encoding="utf-8")
    new_content = re.sub(
        r'(APP_VERSION\s*=\s*["\'])[^"\']+(["\'])',
        rf"\g<1>{new_version}\g<2>",
        content,
    )
    if not dry_run:
        VERSION_JS.write_text(new_content, encoding="utf-8")
    return content != new_content


def update_sw_js(new_version: str, dry_run: bool = False):
    content = SW_JS.read_text(encoding="utf-8")
    
    # 1. CACHE 名の更新
    new_content = re.sub(
        r'(CACHE\s*=\s*["\']tsukijime-ocr-)[^"\']+(["\'])',
        rf"\g<1>{new_version}\g<2>",
        content,
    )

    # 2. PRECACHE リストに src/ 配下のJS/CSSファイルが網羅されているか同期チェック
    src_files = [f"./src/{f}" for f in os.listdir(SRC_DIR) if (f.endswith(".js") or f.endswith(".css")) and os.path.isfile(SRC_DIR / f)]
    view_files = [f"./src/views/{f}" for f in os.listdir(VIEWS_DIR) if f.endswith(".js") and os.path.isfile(VIEWS_DIR / f)]
    all_app_assets = sorted(src_files + view_files)
    
    current_precached = set(re.findall(r'["\'](\./src/[^"\']+)["\']', new_content))
    missing_assets = [a for a in all_app_assets if a not in current_precached]

    if missing_assets:
        anchor = '"./src/views/settings.js",'
        if anchor in new_content:
            insert_text = anchor + "\n" + "".join(f'  "{item}",\n' for item in missing_assets)
            new_content = new_content.replace(anchor, insert_text, 1)
        else:
            print(f"  [注] PRECACHEへの自動挿入基準位置が見つかりませんでしたが、{len(missing_assets)}個の未登録アセットがあります: {missing_assets}")

    if not dry_run:
        SW_JS.write_text(new_content, encoding="utf-8")
    return content != new_content, missing_assets


def main():
    parser = argparse.ArgumentParser(description="システムバージョンの引き上げ（バージョンバンプ）スクリプト")
    parser.add_argument("version", nargs="?", help="引き上げ先のバージョン番号（省略時は現在のバージョン+1）")
    parser.add_argument("--dry-run", action="store_true", help="ファイルへの書き込みを行わず、変更内容をプレビュー表示")
    parser.add_argument("--check", action="store_true", help="現在の各ファイルのバージョン整合性をチェック")
    args = parser.parse_args()

    app_ver, sw_ver = get_current_versions()

    print("=" * 60)
    print(" グッズ交換・月締めシステム システムバージョン管理ツール")
    print("=" * 60)
    print(f"・src/version.js  : {app_ver}")
    print(f"・sw.js (CACHE)    : {sw_ver}")

    if app_ver != sw_ver:
        print("\n[警告] src/version.js と sw.js のバージョンが不一致です！")
    else:
        print("\n[整合性] バージョン整合性は正常です。")

    if args.check:
        sys.exit(0 if app_ver == sw_ver else 1)

    # 引き上げ先バージョンの決定
    current_ver = app_ver or sw_ver or "v27"
    if args.version:
        target = args.version.strip()
        if not target.startswith("v") and not target.startswith("V"):
            target = "v" + target
        new_version = target
    else:
        new_version = increment_version(current_ver)

    print(f"\n引き上げ実行: {current_ver}  ===>  {new_version}")
    if args.dry_run:
        print("※ --dry-run モードのため、ファイル変更は行われません。\n")

    # 1. src/version.js の更新
    v_changed = update_version_js(new_version, dry_run=args.dry_run)
    print(f"[{'変更' if v_changed else '維持'}] src/version.js  -> APP_VERSION = \"{new_version}\"")

    # 2. sw.js の更新
    sw_changed, missing = update_sw_js(new_version, dry_run=args.dry_run)
    print(f"[{'変更' if sw_changed else '維持'}] sw.js           -> CACHE = \"tsukijime-ocr-{new_version}\"")
    if missing:
        print(f"  └ 以下の未キャッシュスクリプトを PRECACHE に追加補完しました:")
        for m in missing:
            print(f"      + {m}")

    print("\n" + "=" * 60)
    if args.dry_run:
        print(f" [完了] プレビュー終了。実際に更新するには引数なしで実行してください:")
        print(f"        python tools/bump_version.py")
    else:
        print(f" [成功] システムバージョンを {new_version} に引き上げました！ ✓")
    print("=" * 60)


if __name__ == "__main__":
    main()
